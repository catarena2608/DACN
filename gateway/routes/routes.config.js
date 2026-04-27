// routes/routes.config.js
module.exports = {
  "/api/auth": "http://localhost:3001",  // Auth service
  "/api/users": "http://localhost:3002", // User service
  "/api/follow": "http://localhost:3002",
  "/api/post": "http://localhost:4001", // Post service
  "/api/save": "http://localhost:4001",
  "/api/like": "http://localhost:4001",
  "/api/comment": "http://localhost:4001",
  "/api/recipe": "http://localhost:5001", // Recipe service
};
