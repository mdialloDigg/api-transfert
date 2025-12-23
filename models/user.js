const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({

  /* =========================
     📤 EXPÉDITEUR
  ========================= */
  senderFirstName: {
    type: String,
    required: true,
    trim: true
  },

  senderLastName: {
    type: String,
    required: true,
    trim: true
  },

  /*email: {
    type: String,
    required: true,
    trim: true
  },*/

  senderPhone: {
    type: String,
    required: true,
    trim: true
  },

  originLocation: {
    type: String,
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  fees: {
    type: Number,
    required: true
  },

  feePercent: {
    type: Number,
    required: true
  },

  /* =========================
     📥 DESTINATAIRE
  ========================= */
  receiverFirstName: {
    type: String,
    required: true,
    trim: true
  },

  receiverLastName: {
    type: String,
    required: true,
    trim: true
  },

  receiverPhone: {
    type: String,
    required: true,
    trim: true
  },

  destinationLocation: {
    type: String,
    required: true
  },

  recoveryAmount: {
    type: Number,
    required: true
  },

  recoveryMode: {
    type: String,
    required: true,
    enum: ['cash', 'mobile_money', 'bank', 'autre']
  },

  /* =========================
     🔐 SÉCURITÉ / SYSTÈME
  ========================= */
  /* password: {
    type: String,
    required: true
  },
*/
  code: {
    type: String,
    required: true,
    unique: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model('User', userSchema);
