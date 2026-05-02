const express = require("express");
const router = express.Router();
const productController = require("../controllers/product.controller");

// GET list + filter
router.get("/", productController.getProduct);

// GET detail
router.get("/:id", productController.getProductById);

// CREATE
router.post("/", productController.addProduct);

// UPDATE
router.patch("/:id", productController.adjustProduct);

// DELETE
router.delete("/:id", productController.deleteProduct);

module.exports = router;