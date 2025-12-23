const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User'); // ⚠️ casse correcte

const router = express.Router();

/* =====================================================
   POST /users → créer une transaction utilisateur
===================================================== */
router.post('/', async (req, res) => {
  try {
    const {
      email,
      password,
      senderFirstName,
      senderLastName,
      senderPhone,
      originLocation,
      amount,
      fees,
      feePercent,
      receiverFirstName,
      receiverLastName,
      receiverPhone,
      destinationLocation,
      recoveryAmount,
      recoveryMode
    } = req.body;

    // ✅ Validation améliorée : vérifie aussi les chaînes vides
    if (
      !email?.trim() || !password?.trim() ||
      !senderFirstName?.trim() || !senderLastName?.trim() || !senderPhone?.trim() ||
      !originLocation?.trim() ||
      amount === undefined || fees === undefined || feePercent === undefined ||
      !receiverFirstName?.trim() || !receiverLastName?.trim() || !receiverPhone?.trim() ||
      !destinationLocation?.trim() ||
      recoveryAmount === undefined || !recoveryMode?.trim()
    ) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    // 🔎 Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Utilisateur déjà existant' });
    }

    // 🔐 Hash mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔢 Générer code (A123)
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    const code = letter + number;

    // 📦 Création utilisateur
    const user = new User({
      email,
      password: hashedPassword,
      code,
      senderFirstName,
      senderLastName,
      senderPhone,
      originLocation,
      amount,
      fees,
      feePercent,
      receiverFirstName,
      receiverLastName,
      receiverPhone,
      destinationLocation,
      recoveryAmount,
      recoveryMode
    });

    await user.save();

    res.status(201).json({
      message: 'Transaction créée avec succès',
      code
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/* =====================================================
   GET /users/all → liste JSON (sans mot de passe)
===================================================== */
router.get('/all', async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
