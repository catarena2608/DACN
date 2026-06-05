const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");

router.get("/",orderController.getOrder);

router.get("/:id",orderController.getOrderById);

router.post("/",orderController.addOrder);

router.delete("/:id",orderController.deleteOrder);

module.exports = router;