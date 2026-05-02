const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    unique: true
  },
  name: String,
  price: Number,
  image: String,
  link: String,
  category: [String],
});

productSchema.index({ name: "text" });
productSchema.index({ price: 1 });
productSchema.index({ category: 1 });

const Product = mongoose.model("Product", productSchema, "product");

// ✅ export tất cả trong 1 object
module.exports = {
  Product,

  findProducts: (filter, skip, limit) => {
    return Product.find(filter).skip(skip).limit(limit).lean();
  },

  countProducts: (filter) => {
    return Product.countDocuments(filter);
  },

  findProductById: (id) => {
    return Product.findById(id).lean();
  },

  findLastProduct: () => {
    return Product.findOne().sort({ _id: -1 }).lean();
  },

  createProduct: (data) => {
    return Product.create(data);
  },

  updateProduct: (id, data) => {
    return Product.findByIdAndUpdate(id, data, { new: true });
  },

  deleteProduct: (id) => {
    return Product.findByIdAndDelete(id);
  }
};