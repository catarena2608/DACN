const ms = require("ms");
const { findUserByEmail, createUser } = require("../models/user.model");
const { hashPassword, comparePassword } = require("../utils/hash");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");
const redis = require("../utils/redis");

// Hàm helper để lấy TTL cho Redis (đổi từ ms sang giây)
const getRedisTTL = () => Math.round(ms(process.env.JWT_REFRESH_EXPIRES_IN) / 1000);

exports.register = async ({ email, name, password }) => {
  const existing = await findUserByEmail(email);
  if (existing) throw new Error("Email already exists");

  const hashed = await hashPassword(password);
  const user = { email, name, password: hashed };
  await createUser(user);

  return user;
};

exports.login = async ({ email, password }) => {
  const user = await findUserByEmail(email);
  if (!user) throw new Error("User not found");

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) throw new Error("Wrong password");

  const payload = { userId: user._id, email: user.email };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Whitelist vào Redis
  await redis.set(`rf_token:${user._id}`, refreshToken, "EX", getRedisTTL());

  return { accessToken, refreshToken };
};

exports.refreshToken = async (token) => {
  // 1. Verify token
  const decoded = verifyRefreshToken(token);

  // 2. Kiểm tra whitelist
  const savedToken = await redis.get(`rf_token:${decoded.userId}`);
  
  if (token !== savedToken) {
    // Phát hiện token cũ/giả mạo -> thu hồi ngay lập tức
    if (decoded.userId) await redis.del(`rf_token:${decoded.userId}`);
    throw new Error("Token revoked or reused!");
  }

  // 3. Rotate tokens
  const payload = { userId: decoded.userId, email: decoded.email };
  const newAccessToken = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  // Update whitelist với TTL đồng bộ
  await redis.set(`rf_token:${decoded.userId}`, newRefreshToken, "EX", getRedisTTL());

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

exports.logout = async (token) => {
  try {
    const decoded = verifyRefreshToken(token);
    if (decoded?.userId) {
      await redis.del(`rf_token:${decoded.userId}`);
    }
  } catch (err) {
    // Token hết hạn thì cũng coi như logout xong, không cần throw error
  }
};