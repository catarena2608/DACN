const { runWithSpan } = require("../utils/tracer");
const productModel = require("../models/product.model");
const detailModel = require("../models/detail.model");
const redis = require("../utils/redis");
const {acquireLock,releaseLock,} = require("../utils/lock");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findCacheKeys(pattern) {
  if (typeof redis.nodes === "function") {
    const masters = redis.nodes("master");
    const keyGroups = await Promise.all(masters.map((node) => node.keys(pattern)));
    return [...new Set(keyGroups.flat())];
  }

  return redis.keys(pattern);
}

async function deleteCacheKeys(keys) {
  if (!keys.length) return;
  await Promise.all(keys.map((key) => redis.del(key)));
}

async function clearProductListCache() {
  const keys = await findCacheKeys("products:*");
  await deleteCacheKeys(keys);
}

// ================== GET ==================
exports.getProducts = async (query) => {
  const key = `products:${JSON.stringify(query)}`;
  const lockKey = `lock:${key}`;

  // 1. Check cache.
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Try to acquire lock.
  const isLocked = await redis.set(lockKey, "1", "NX", "EX", 5);

  if (!isLocked) {
    // Another request is already fetching the data; wait briefly.
    await sleep(100);

    const retry = await redis.get(key);
    if (retry) return JSON.parse(retry);

    // Fallback if the cache is still empty.
    throw new Error("Server busy, retry");
  }

  try {
    // Cache miss; query the database.
    const {
      category,
      name,
      minPrice,
      maxPrice,
      page = 1,
      limit = 10
    } = query;

    let filter = {};

    if (category) filter.category = category;

    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      productModel.findProducts(filter, skip, Number(limit)),
      productModel.countProducts(filter)
    ]);

    const result = {
      products,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit)
    };

    // Set cache.
    const ttl = 60 + Math.floor(Math.random() * 20);
    await redis.set(key, JSON.stringify(result), "EX", ttl);

    return result;
  } finally {
    // Release lock.
    await redis.del(lockKey);
  }
};

// ================== GET BY ID ==================
exports.getProductById = async (id) => {
  const key = `product:${id}`;
  const lockKey = `lock:${key}`;

  // 1. Check cache.
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Try to acquire lock.
  const isLocked = await redis.set(lockKey, "1", "NX", "EX", 5);

  if (!isLocked) {
    await sleep(100);

    const retry = await redis.get(key);
    if (retry) return JSON.parse(retry);

    throw new Error("Server busy, retry");
  }

  try {
    const product = await productModel.findProductById(id);
    if (!product) return null;

    const detail = await detailModel.findDetailById(id);

    const result = {
      ...product,
      description: detail?.description || null
    };

    const ttl = 120 + Math.floor(Math.random() * 30);
    await redis.set(key, JSON.stringify(result), "EX", ttl);

    return result;
  } finally {
    await redis.del(lockKey);
  }
};

// ================== CREATE ==================
exports.createProduct = async (data) => {
  const lastProduct = await productModel.findLastProduct();

  let newId = "0001";
  if (lastProduct) {
    newId = String(Number(lastProduct._id) + 1).padStart(4, "0");
  }

  const newProduct = await productModel.createProduct({
    _id: newId,
    ...data
  });

  // Clear list cache.
  await clearProductListCache();

  return newProduct;
};

// ================== UPDATE ==================
exports.updateProduct = async (id, data) => {
  const updated = await productModel.updateProduct(id, data);

  // Clear detail cache.
  await redis.del(`product:${id}`);

  // Clear all list cache entries.
  await clearProductListCache();

  return updated;
};

// ================== DELETE ==================
exports.deleteProduct = async (id) => {
  await productModel.deleteProduct(id);

  await redis.del(`product:${id}`);

  await clearProductListCache();
};

// ================== Lock + RabbitMQ ==================

// ================== Reverse ==================
exports.reserveStock = async (productID, quantity) => {
  const lockKey = `lock:product:${productID}`;

  const token = await acquireLock(lockKey, 10000);

  if (!token) {
    throw new Error("Product busy");
  }

  try {
    const product = await productModel.findProductById(productID);

    if (!product) {
      throw new Error("Product not found");
    }

    if (product.stock < quantity) {
      throw new Error("Out of stock");
    }

    await productModel.updateProduct(
      productID,
      {
        stock: product.stock - quantity,
      }
    );

    await redis.del(`product:${productID}`);

    await clearProductListCache();

    return {
      success: true,
      productID,
      name: product.name,
      price: product.price,
      quantity,
    };

  } finally {
    await releaseLock(lockKey,token);
  }
};

// ================== Release ==================
exports.releaseStock = async (productID,quantity) => {

  const lockKey =`lock:product:${productID}`;

  const token =await acquireLock(lockKey,10000);

  if (!token) {
    throw new Error("Product busy");
  }

  try {

    const product =await productModel.findProductById(productID);

    if (!product) {
      throw new Error("Product not found");
    }

    await productModel.updateProduct(
      productID,
      {
        stock: product.stock + quantity,
      }
    );

    await redis.del(`product:${productID}`);

    await clearProductListCache();

    return {
      success: true,
    };

  } finally {
    await releaseLock(lockKey,token);
  }
};
