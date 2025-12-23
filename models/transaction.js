const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema({
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: Number,
    status: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", TransactionSchema);