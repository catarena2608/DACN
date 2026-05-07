const express = require("express");
require("dotenv").config();

const mongoose = require("mongoose");
const cors = require("cors");

const productRoutes = require("./routes/product.routes");
const healthRoutes = require("./routes/health.routes");
const {
  
} = require("./models/product.model");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/health", healthRoutes);
app.use("/api/product", productRoutes);

// ================== MONGOOSE CONNECT ==================
console.log("URI:", process.env.URI);
const MONGO_URI = process.env.URI;

async function connectDB() {
  await mongoose.connect(MONGO_URI);
  console.log("🔌 MongoDB connected");
}


// ================== INIT ==================
async function init() {
  await connectDB();
}

init().catch(console.error);

module.exports = app;