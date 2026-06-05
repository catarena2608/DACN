const authService = require("../services/auth.service");

// Cấu hình cookie dùng chung
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
};

exports.register = async (req, res) => {
  try {
    const user = await authService.register(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { accessToken, refreshToken } = await authService.login(req.body);
    
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};

exports.refresh = async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) throw new Error("No refresh token");

    const { accessToken, refreshToken } = await authService.refreshToken(token);

    // Set lại cookie mới (Rotation)
    res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);
    res.json({ accessToken });
  } catch (err) {
    res.status(403).json({ message: err.message });
  }
};

exports.logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) {
    await authService.logout(token);
  }
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out" });
};