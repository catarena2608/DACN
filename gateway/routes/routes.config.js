// routes/routes.config.js
module.exports = {
  "/api/auth": process.env.AUTH_SERVICE_URL,  // Auth service
  "/api/products": process.env.PRODUCT_SERVICE_URL,
  "/api/users": process.env.PRODUCT_SERVICE_URL, // User service
  "/api/follow": process.env.PRODUCT_SERVICE_URL,
};
