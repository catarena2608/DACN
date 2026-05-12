// routes/routes.config.js
module.exports = {
  "/api/auth": process.env.AUTH_SERVICE_URL,  // Auth service
  "/api/users": process.env.PRODUCT_SERVICE_URL, // User service
  "/api/follow": process.env.PRODUCT_SERVICE_URL,
};
