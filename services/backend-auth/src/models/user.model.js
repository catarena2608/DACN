const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const userSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => uuidv4(),
  },
  email: { type: String, required: true, unique: true },
  name: String,
  password: String,
});

const User = mongoose.model("UserAuth", userSchema, "userAuth");

exports.createUser = async (user) => {
  return User.create(user);
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
