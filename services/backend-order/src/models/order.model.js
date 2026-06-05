const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const orderItemSchema = new mongoose.Schema(
  {
    productID: {
      type: String,
      required: true,
    },
    num: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: uuidv4,
    },

    userID: {
      type: String,
      required: true,
      index: true,
    },

    products: [orderItemSchema],

    total: {
      type: Number,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

orderSchema.index({ userID: 1 });

const Order = mongoose.model("Order",orderSchema,"order");

module.exports = {
  Order,

  createOrder: (data) =>Order.create(data),

  findOrders: (filter) =>Order.find(filter).lean(),

  findOrderById: (id) =>Order.findById(id).lean(),

  deleteOrder: (id) =>Order.findByIdAndDelete(id),
};