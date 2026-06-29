const express = require("express");
require("dotenv").config();

const mongoose = require("mongoose");
const cors = require("cors");

const productRoutes = require("./routes/product.routes");
const healthRoutes = require("./routes/health.routes");
const testRunLogger = require("./middlewares/testRunLogger");

const startProductConsumer = require("./utils/product.consumer");

const app = express();

app.use(testRunLogger(process.env.SERVICE_NAME || "product-service"));
app.use(cors());
app.use(express.json());

app.use("/health", healthRoutes);
app.use("/", productRoutes);

const MONGO_URI = process.env.URI;

async function connectDB() {
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected");
}

async function init() {
  await connectDB();
  await startProductConsumer();
}

init().catch(console.error);

module.exports = app;
