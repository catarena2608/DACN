const redis = require("../utils/redis");

const CAPACITY = 20;
const REFILL_RATE = 5;

const luaScript = `
local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call("HMGET", key, "tokens", "timestamp")

local tokens = tonumber(data[1])
local lastTime = tonumber(data[2])

if not tokens then
  tokens = capacity
end

if not lastTime then
  lastTime = now
end

local delta = math.max(0, now - lastTime)

tokens = math.min(capacity, tokens + delta * refillRate)

if tokens < 1 then

  redis.call( "HMSET", key, "tokens", tokens, "timestamp", now)

  redis.call("EXPIRE", key, 3600)

  return { 0, tokens}
end

tokens = tokens - 1

redis.call("HMSET", key, "tokens", tokens, "timestamp", now)

redis.call( "EXPIRE", key, 3600)

return { 1, tokens}
`;

module.exports = async (req, res, next) => {

  try {

    const userId =req.user?.id ||
      req.user?._id ||
      req.user?.userId ||
      req.headers["x-user-id"] ||
      req.ip ||
      "anonymous";
    const key =`bucket:{${userId}}`;
    const now = Date.now() / 1000;
    const result = await redis.eval(luaScript, 1, key, CAPACITY, REFILL_RATE, now);
    const allowed = Number(result[0]);
    const remaining = Math.floor(Number(result[1]));

    res.setHeader(
      "X-RateLimit-Remaining",
      remaining
    );

    if (!allowed) {
      return res
        .status(429)
        .json({
          message:
            "Too many requests"
        });
    }

    next();

  } catch (err) {

    console.error(
      "RateLimiter:",
      err.message
    );

    next();
  }
};