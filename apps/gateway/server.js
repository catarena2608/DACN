  require("dotenv").config();
  const express = require("express");
  const http = require("http");
  const cors = require("cors");
  const cookieParser = require("cookie-parser");
  const jwt = require("jsonwebtoken");
  const rateLimiter = require("./middleware/rateLimiter");

  const app = express();

  app.use(cookieParser());
  app.use(
    cors({
      origin: ["http://localhost:5173" ,"http://127.0.0.1:5500", "http://localhost:5500"],
      credentials: true,
    })
  );

  // ================== MAP SERVICE ==================
  const serviceMap = require("./routes/routes.config");
  const healthRoutes = require("./routes/health.routes");

  app.use("/api/health", healthRoutes);
  // ================== JWT MIDDLEWARE ==================
  app.use(async (req, res, next) => {
    // Skip JWT checks for auth routes, health checks, and gateway root.
    if (
      req.path === "/" ||
      req.originalUrl.startsWith("/api/auth") || 
      req.originalUrl.endsWith("/health") ||
      req.originalUrl === "/health"
    ) {
      return next();
    }

    // Read token, preferring cookie and then Authorization header.
    const token =
      req.cookies?.token ||
      req.headers["authorization"]?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ message: "Missing authentication token" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // Store payload for downstream services.
      next();
    } catch (err) {
      console.error("❌ JWT error:", err.message);
      return res
        .status(403)
        .json({ message: "Invalid or expired token" });
    }
  });
  // ================== RATE LIMITER ==================

  app.use(rateLimiter);


  // ================== PROXY ==================
  app.use("/api", (req, res) => {
    // 1. Resolve target service.
    let targetBase = null;
    let targetPrefix = "";
    for (const prefix in serviceMap) {
      if (req.originalUrl.startsWith(prefix)) {
        targetBase = serviceMap[prefix];
        targetPrefix = prefix;
        break;
      }
    }

    if (!targetBase) {
      console.log(`[Gateway] No service found for ${req.originalUrl}`);
      return res
        .status(404)
        .json({ message: "No matching service found" });
    }
    const cleanPath = req.originalUrl.replace(targetPrefix, "") || "/";
    // 2. Preserve path and query.
    const targetUrl = new URL(targetBase + cleanPath);

    console.log(
      `[Gateway 🚀] ${req.method} ${req.originalUrl} → ${targetUrl.href}`
    );

    // 3. Copy headers.
    const headers = { ...req.headers };
    delete headers.host;

    // Attach decoded user information for downstream services.
    if (req.user) {
      headers["x-user-id"] = req.user.userId || req.user.id || req.user._id;
      headers["x-user-email"] = req.user.email;
    }

    // 4. Create request to target service.
    const options = {
      method: req.method,
      headers,
    };

    const proxyReq = http.request(targetUrl, options, (proxyRes) => {
      res.status(proxyRes.statusCode);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        res.setHeader(key, value);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error(`[Gateway ❌] ${req.method} ${targetUrl.href} → ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ message: "Internal service connection error" });
      }
    });

    // 5. Forward request body.
    req.pipe(proxyReq);
  });

  // ================== ROOT ==================
  app.get("/", (req, res) => res.send("API Gateway is running"));

  // ================== START ==================
  const PORT = process.env.GATEWAY_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Gateway running at http://localhost:${PORT}`);
  });
