const Redis = require("ioredis");

const redis = new Redis.Cluster(
  [
    { host: "192.168.79.129", port: 7001 },
    { host: "192.168.79.129", port: 7002 },
    { host: "192.168.79.129", port: 7003 },
    { host: "192.168.79.129", port: 7004 },
    { host: "192.168.79.129", port: 7005 },
    { host: "192.168.79.129", port: 7006 },
  ],
  {
    redisOptions: { connectTimeout: 10000 },
    scaleReads: "slave",
    clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
  }
);

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));

module.exports = redis;