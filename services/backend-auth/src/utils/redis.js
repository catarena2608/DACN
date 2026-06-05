const Redis = require("ioredis");

const commonOptions = {
  connectTimeout: 10000,
};

function createRedisClient() {
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, commonOptions);
  }

  const nodesString = process.env.REDIS_NODES;
  if (!nodesString) {
    throw new Error("REDIS_URL or REDIS_NODES is required");
  }

  const nodes = nodesString.split(",").map((node) => {
    const [host, port] = node.split(":");
    return { host, port: Number.parseInt(port, 10) };
  });

  return new Redis.Cluster(nodes, {
    redisOptions: {
      ...commonOptions,
      enableReadyCheck: true,
    },
    dnsLookup: (address, callback) => callback(null, address),
    scaleReads: "master",
    clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
  });
}

const redis = createRedisClient();

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

module.exports = redis;
