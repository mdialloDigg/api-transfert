/******************************************************************
 * SERVER.JS – VERSION FINALE STABLE
 * - Pas de crash si MONGO_URI absent
 * - Pas de MemoryStore warning
 * - Un seul fichier
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

/* ===================== MIDDLEWARE BASIQUE ===================== */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ===================== ÉTAT GLOBAL ===================== */
let mongoReady = false;

/* ===================== MONGODB (SANS CRASH) ===================== */
if (typeof MONGO_URI === 'string' && MONGO_URI.trim() !== '') {
  mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => {
    mongoReady = true;
    console.log('✅ MongoDB connecté');

    /* ✅ SESSION UNIQUEMENT SI MONGO OK */
    app.use(session({
      secret: 'render-secret-final',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: MONGO_URI })
    }));
  })
  .catch(err => {
    console.error('❌ MongoDB erreur :', err.message);
  });
} else {
  console.warn('⚠️ MONGO_URI non défini — application lancée sans base de données');
}

/* ===================== MODÈLES ===================== */
let Stock;

if (mongoReady || MONGO_URI) {
  const stockSchema = new mongoose.Schema({
    sender: String,
    destination: String,
    amount: Number,
    currency: String,
    createdAt: { type: Date, default: Date.now }
  });

  Stock = mongoose.model('Stock', stockSchema);
}

/* ===================== ROUTES ===================== */

/* ---- PAGE PRINCIPALE ---- */
app.get('/', async (req, res) => {
  if (!mongoReady) {
    return res.send(`
      <h1>⚠️ Configuration requise</h1>
      <p>La variable <b>MONGO_URI</b> n’est pas définie.</p>
      <p>👉 Render → Environment → Add Environment Variable</p>
      <pre>MONGO_URI = mongodb+srv://user:password@cluster.mongodb.net/db</pre>
    `);
  }

  const stocks = await Stock.find();

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stocks</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial; padding: 15px; }
    input, button { padding: 8px; margin: 4px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #ccc; padding: 6px; }
  </style>
</head>
<body>

<h2>📦 Stocks</h2>

<table>
  <tr>
    <th>Sender</th>
    <th>Destination</th>
    <th>Amount</th>
    <th>Currency</th>
  </tr>
  ${stocks.map(s => `
    <tr>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
    </tr>
  `).join('')}
</table>

<h3>➕ Ajouter un stock</h3>
<input id="sender" placeholder="Sender">
<input id="destination" placeholder="Destination">
<input id="amount" placeholder="Amount" type="number">
<input id="currency" placeholder="Currency">
<button onclick="addStock()">Ajouter</button>

<script>
async function addStock() {
  const res = await fetch('/stock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: sender.value,
      destination: destination.value,
      amount: Number(amount.value),
      currency: currency.value
    })
  });
  const data = await res.json();
  alert(data.message);
  if (data.ok) location.reload();
}
</script>

</body>
</html>
  `);
});

/* ---- API AJOUT STOCK ---- */
app.post('/stock', async (req, res) => {
  if (!mongoReady) {
    return res.json({
      ok: false,
      message: 'Base de données non connectée'
    });
  }

  try {
    await Stock.create(req.body);
    res.json({ ok: true, message: 'Stock ajouté' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

/* ===================== SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
});
