const express = require("express");
const router = express.Router();
const productController = require("../controllers/product.controller");

router.get("/", productController.getProduct);
router.get("/:id", productController.getProductById);
router.post("/", productController.addProduct);
router.patch("/:id", productController.adjustProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
