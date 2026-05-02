// routes/routes.config.js
module.exports = {
  "/api/auth": process.env.AUTH_SERVICE_URL,  // Auth service
  "/api/users": process.env.PRODUCT_SERVICE_URL, // User service
  "/api/follow": process.env.PRODUCT_SERVICE_URL,
  "/api/post": process.env.POST_SERVICE_URL, // Post service
  "/api/save": process.env.POST_SERVICE_URL,
  "/api/like": process.env.POST_SERVICE_URL,
  "/api/comment": process.env.POST_SERVICE_URL,
  "/api/recipe": process.env.RECIPE_SERVICE_URL, // Recipe service
};
