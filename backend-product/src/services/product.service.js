const productModel = require("../models/product.model");
const detailModel = require("../models/detail.model");
const redis = require("../utils/redis");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================== GET ==================
exports.getProducts = async (query) => {
  const key = `products:${JSON.stringify(query)}`;
  const lockKey = `lock:${key}`;

  // 🔥 1. Check cache
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // 🔒 2. Try acquire lock
  const isLocked = await redis.set(lockKey, "1", "NX", "EX", 5);

  if (!isLocked) {
    // 👉 Có thằng khác đang fetch → chờ
    await sleep(100);

    const retry = await redis.get(key);
    if (retry) return JSON.parse(retry);

    // fallback nếu vẫn chưa có
    throw new Error("Server busy, retry");
  }

  try {
    // ❌ Miss cache → query DB
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

    // 🔥 Set cache
    const ttl = 60 + Math.floor(Math.random() * 20);
    await redis.set(key, JSON.stringify(result), "EX", ttl);

    return result;
  } finally {
    // 🔓 Release lock
    await redis.del(lockKey);
  }
};

// ================== GET BY ID ==================
exports.getProductById = async (id) => {
  const key = `product:${id}`;
  const lockKey = `lock:${key}`;

  // 🔥 1. Check cache
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // 🔒 2. Try lock
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

  // ❗ clear list cache
  const keys = await redis.keys("products:*");
  if (keys.length) await redis.del(keys);

  return newProduct;
};

// ================== UPDATE ==================
exports.updateProduct = async (id, data) => {
  const updated = await productModel.updateProduct(id, data);

  // ❗ Xóa cache detail
  await redis.del(`product:${id}`);

  // ❗ Xóa toàn bộ list cache
  const keys = await redis.keys("products:*");
  if (keys.length) await redis.del(keys);

  return updated;
};

// ================== DELETE ==================
exports.deleteProduct = async (id) => {
  await productModel.deleteProduct(id);

  await redis.del(`product:${id}`);

  const keys = await redis.keys("products:*");
  if (keys.length) await redis.del(keys);
};