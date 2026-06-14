const mongoose = require("mongoose");

const detailSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
    unique: true
  },
  description: String,
});

const Detail = mongoose.model("Detail", detailSchema, "detail");
// ================== METHODS ==================

// Export all helpers in one object.
module.exports = {
  Detail,
  findDetailById: (id)=>{
    return Detail.findById(id).lean();
  }
};
