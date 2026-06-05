const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const redis = require("../utils/redis");

router.get("/", async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: "OK",
    timestamp: Date.now(),
    services: {
        database: "disconnected",
        redis: "disconnected"
    }
  };

  try {
    // Kiểm tra MongoDB
    if (mongoose.connection.readyState === 1) {
        healthcheck.services.database = "connected";
    }

    // Kiểm tra Redis
    const redisPing = await redis.ping();
    if (redisPing === "PONG") {
        healthcheck.services.redis = "connected";
    }

    res.status(200).json(healthcheck);
  } catch (error) {
    healthcheck.message = error.message;
    res.status(503).json(healthcheck);
  }
});

module.exports = router;