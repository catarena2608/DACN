const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

require("dotenv").config();

const mongoose = require("mongoose");

const healthRoutes = require("./routes/health.routes");
const orderRoutes = require("./routes/order.routes");

const { connectRabbit } = require("./utils/rabbit");

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use("/health", healthRoutes);
app.use("/", orderRoutes);

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
  await connectRabbit();
}

init().catch(console.error);

module.exports = app;