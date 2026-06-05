const orderModel = require("../models/order.model");
const redis = require("../utils/redis");
const { acquireLock, releaseLock } = require("../utils/lock");
const { callProduct } = require("../utils/product.rpc");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================== GET ==================

exports.getOrder = async (query) => {
  const cacheKey = `orders:${JSON.stringify(query)}`;
  const lockKey = `lock:${cacheKey}`;

  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const token = await acquireLock(lockKey, 5000);

  if (!token) {
    await sleep(100);

    const retry = await redis.get(cacheKey);

    if (retry) {
      return JSON.parse(retry);
    }

    throw new Error("Server busy");
  }

  try {
    const filter = {};

    if (query.orderID) {
      filter._id = query.orderID;
    }

    if (query.userID) {
      filter.userID = query.userID;
    }

    if (query.productID) {
      filter["products.productID"] = query.productID;
    }

    const result = await orderModel.findOrders(filter);

    await redis.set(
      cacheKey,
      JSON.stringify(result),
      "EX",
      60 + Math.floor(Math.random() * 20)
    );

    return result;

  } finally {
    await releaseLock(lockKey, token);
  }
};

// ================== GET BY ID ==================

exports.getOrderById = async (id) => {
  const cacheKey = `order:${id}`;
  const lockKey = `lock:${cacheKey}`;

  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const token = await acquireLock(lockKey, 5000);

  if (!token) {
    await sleep(100);

    const retry = await redis.get(cacheKey);

    if (retry) {
      return JSON.parse(retry);
    }

    throw new Error("Server busy");
  }

  try {
    const order = await orderModel.findOrderById(id);

    if (!order) {
      throw new Error("Order not found");
    }

    await redis.set(
      cacheKey,
      JSON.stringify(order),
      "EX",
      120 + Math.floor(Math.random() * 30)
    );

    return order;

  } finally {
    await releaseLock(lockKey, token);
  }
};

// ================== CREATE ==================

exports.addOrder = async ({
  userID,
  products,
  address,
}) => {

  const reserved = [];
  let total = 0;
  const orderProducts = [];

  try {

    for (const item of products) {

      const result = await callProduct({
        action: "RESERVE_STOCK",
        productID: item.productID,
        quantity: item.num,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      reserved.push({
        productID: item.productID,
        quantity: item.num,
      });

      total += result.price * item.num;

      orderProducts.push({
        productID: item.productID,
        num: item.num,
        price: result.price,
      });
    }

    const order = await orderModel.createOrder({
      userID,
      products: orderProducts,
      total,
      address,
    });

    const keys = await redis.keys("orders:*");

    if (keys.length) {
      await redis.del(...keys);
    }

    return order;

  } catch (err) {

    for (const item of reserved) {

      await callProduct({
        action: "RELEASE_STOCK",
        productID: item.productID,
        quantity: item.quantity,
      });
    }

    throw err;
  }
};

// ================== DELETE ==================

exports.deleteOrder = async (orderID) => {

  const lockKey = `lock:order:${orderID}`;

  const token = await acquireLock(
    lockKey,
    10000
  );

  if (!token) {
    throw new Error("Order busy");
  }

  try {

    const order = await orderModel.findOrderById(orderID);

    if (!order) {
      throw new Error("Order not found");
    }

    for (const item of order.products) {

      const result = await callProduct({
        action: "RELEASE_STOCK",
        productID: item.productID,
        quantity: item.num,
      });

      if (!result.success) {
        throw new Error(result.error);
      }
    }

    await orderModel.deleteOrder(orderID);

    await redis.del(`order:${orderID}`);

    const keys = await redis.keys("orders:*");

    if (keys.length) {
      await redis.del(...keys);
    }

    return {
      success: true,
    };

  } finally {
    await releaseLock(lockKey, token);
  }
};