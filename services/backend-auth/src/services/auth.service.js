const ms = require("ms");
const { findUserByEmail, createUser } = require("../models/user.model");
const { hashPassword, comparePassword } = require("../utils/hash");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");
const redis = require("../utils/redis");
// Import helper tracer
const { runWithSpan } = require("../utils/tracer");

const getRedisTTL = () => Math.round(ms(process.env.JWT_REFRESH_EXPIRES_IN) / 1000);

exports.register = async (data) => {
  return await runWithSpan("auth.service.register", async (span) => {
    span.setAttribute("user.email", data.email);
    
    const existing = await findUserByEmail(data.email);
    if (existing) throw new Error("Email already exists");

    const hashed = await hashPassword(data.password);
    const user = await createUser({ ...data, password: hashed });
    
    return user;
  });
};

exports.login = async ({ email, password }) => {
  return await runWithSpan("auth.service.login", async (span) => {
    span.setAttribute("user.email", email);

    const user = await findUserByEmail(email);
    if (!user) throw new Error("User not found");

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) throw new Error("Wrong password");

    const payload = { userId: user._id, email: user.email };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    await redis.set(`rf_token:${user._id}`, refreshToken, "EX", getRedisTTL());

    return { accessToken, refreshToken };
  });
};

exports.refreshToken = async (token) => {
  return await runWithSpan("auth.service.refresh_token", async (span) => {
    const decoded = verifyRefreshToken(token);
    span.setAttribute("user.id", decoded.userId);

    const savedToken = await redis.get(`rf_token:${decoded.userId}`);
    
    if (token !== savedToken) {
      if (decoded.userId) await redis.del(`rf_token:${decoded.userId}`);
      throw new Error("Token revoked or reused!");
    }

    const payload = { userId: decoded.userId, email: decoded.email };
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    await redis.set(`rf_token:${decoded.userId}`, newRefreshToken, "EX", getRedisTTL());

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  });
};

exports.logout = async (token) => {
  return await runWithSpan("auth.service.logout", async (span) => {
    try {
      const decoded = verifyRefreshToken(token);
      if (decoded?.userId) {
        span.setAttribute("user.id", decoded.userId);
        await redis.del(`rf_token:${decoded.userId}`);
      }
    } catch (err) {
      // Token hết hạn coi như logout xong
    }
  });
};