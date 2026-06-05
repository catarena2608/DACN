const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const authRoutes = require("./routes/auth.routes");
const healthRoutes = require("./routes/health.routes");
const {
  countUsers,
  insertManyUsers,
} = require("./models/user.model");

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use("/health", healthRoutes);
app.use("/", authRoutes);

// ================== MONGOOSE CONNECT ==================
console.log("URI:", process.env.URI);
const MONGO_URI = process.env.URI;

async function connectDB() {
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected");
}

// ================== SEED DATA ==================
async function seedData() {
  const count = await countUsers();

  if (count === 0) {
    console.log("Seeding auth.json...");

    const filePath = path.join(__dirname, "../auth.json");
    const raw = fs.readFileSync(filePath);
    const users = JSON.parse(raw);

    const hashedUsers = await Promise.all(
        users.map(async (u) => ({
            email: u.email,
            name: u.name,
            password: await bcrypt.hash(u.password, 10),
        }))
    );

    await insertManyUsers(hashedUsers);

    console.log("Seed completed!");
  } else {
    console.log("Data already exists, skip seed.");
  }
}

// ================== INIT ==================
async function init() {
  await connectDB();
  await seedData();
}

init().catch(console.error);

module.exports = app;