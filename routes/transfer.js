const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const auth = require("../middleware/auth");

const router = express.Router();

router.post("/", auth, async (req, res) => {
    const { to, amount } = req.body;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const sender = await User.findById(req.userId).session(session);
        const receiver = await User.findById(to).session(session);

        if (!receiver) throw "Destinataire introuvable";
        if (sender.balance < amount) throw "Solde insuffisant";

        sender.balance -= amount;
        receiver.balance += amount;

        await sender.save();
        await receiver.save();

        await Transaction.create([{
            from: sender._id,
            to: receiver._id,
            amount,
            status: "SUCCESS"
        }], { session });

        await session.commitTransaction();
        res.json({ message: "Transfert réussi" });

    } catch (err) {
        await session.abortTransaction();
        res.status(400).json({ error: err });
    }

    session.endSession();
});

module.exports = router;