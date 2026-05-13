const Redis = require("ioredis");

const nodesString = process.env.REDIS_NODES || "";

const nodes = nodesString.split(",").map(node => {
    const [host, port] = node.split(":");
    return { host, port: parseInt(port) };
});

const redis = new Redis.Cluster(nodes, {
  redisOptions: { 
    connectTimeout: 10000,
    enableReadyCheck: true 
  },
  dnsLookup: (address, callback) => callback(null, address),
  scaleReads: "master", 
  clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));

module.exports = redis;