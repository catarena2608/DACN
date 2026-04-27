const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const userSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => uuidv4(), // 👈 auto generate
  },
  email: { type: String, required: true, unique: true },
  name: String,
  password: String,
});

const User = mongoose.model("UserAuth", userSchema, "userAuth");

// ================== METHODS ==================

exports.createUser = async (user) => {
  return User.create(user); // không cần truyền _id nữa
};

exports.findUserByEmail = async (email) => {
  return User.findOne({ email });
};

exports.countUsers = async () => {
  return User.countDocuments();
};

exports.insertManyUsers = async (users) => {
  return User.insertMany(users);
};