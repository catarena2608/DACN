const crypto = require("crypto");
const redis = require("./redis");

async function acquireLock(key, ttl = 10000) {
  const token = crypto.randomUUID();

  const result = await redis.set(
    key,
    token,
    "NX",
    "PX",
    ttl
  );

  return result ? token : null;
}

async function releaseLock(key, token) {
  const lua = `
    if redis.call("GET", KEYS[1]) == ARGV[1]
    then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  await redis.eval(lua, 1, key, token);
}

module.exports = {
  acquireLock,
  releaseLock,
};