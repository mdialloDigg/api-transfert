/******************************************************************
 * APP TRANSFERT – VERSION CORRIGÉE PRODUCTION
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => console.error(err));

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: String,
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: String,
  recoveryMode: String,
  retired: { type: Boolean, default: false },
  retraitHistory: [{ date: Date, mode: String }],
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, default: 'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
           Math.floor(100 + Math.random() * 900);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

/* ================= LOGIN ================= */
app.get('/login', (req, res) => {
  res.send(`
  <form method="post">
    <h2>Connexion</h2>
    <input name="username" required placeholder="Utilisateur">
    <input type="password" name="password" required placeholder="Mot de passe">
    <button>Connexion</button>
  </form>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if (!user) {
    user = await Auth.create({
      username,
      password: bcrypt.hashSync(password, 10)
    });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    return res.send('Mot de passe incorrect');
  }
  req.session.user = user;
  res.redirect('/transferts/list');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= TRANSFERT LIST ================= */
app.get('/transferts/list', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });

  let html = `<h2>Liste des transferts</h2>
  <a href="/transferts/form">➕ Nouveau</a> |
  <a href="/transferts/stock">📦 Stock</a> |
  <a href="/logout">🚪 Déconnexion</a>
  <table border="1">
  <tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;

  transferts.forEach(t => {
    html += `<tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount} ${t.currency}</td>
    </tr>`;
  });

  html += '</table>';
  res.send(html);
});

/* ================= TRANSFERT FORM ================= */
app.get('/transferts/form', requireLogin, async (req, res) => {
  const code = await generateUniqueCode();
  res.send(`
  <form method="post">
    <input name="senderFirstName" placeholder="Prénom expéditeur" required>
    <input name="senderLastName" placeholder="Nom expéditeur" required>
    <input name="receiverFirstName" placeholder="Prénom destinataire" required>
    <input name="receiverLastName" placeholder="Nom destinataire" required>
    <input type="number" name="amount" placeholder="Montant" required>
    <input type="number" name="fees" placeholder="Frais" required>
    <input name="currency" value="GNF">
    <input name="code" value="${code}" readonly>
    <button>Enregistrer</button>
  </form>
  <a href="/transferts/list">⬅ Retour</a>
  `);
});

app.post('/transferts/form', requireLogin, async (req, res) => {
  const amount = Number(req.body.amount);
  const fees = Number(req.body.fees);
  await Transfert.create({
    ...req.body,
    amount,
    fees,
    recoveryAmount: amount - fees
  });
  res.redirect('/transferts/list');
});

/* ================= STOCK ================= */
app.get('/transferts/stock', requireLogin, async (req, res) => {
  const stocks = await Stock.find().sort({ createdAt: -1 });

  let html = `<h2>Stock</h2>
  <a href="/transferts/stock/nouveau">➕ Nouveau</a> |
  <a href="/transferts/list">⬅ Retour</a>
  <table border="1">
  <tr><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;

  stocks.forEach(s => {
    html += `<tr>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount} ${s.currency}</td>
    </tr>`;
  });

  html += '</table>';
  res.send(html);
});

/* ================= STOCK MULTI ================= */
app.post('/transferts/stock/multi', requireLogin, async (req, res) => {
  const { stocks } = req.body;
  if (!Array.isArray(stocks) || stocks.length === 0) {
    return res.json({ ok: false });
  }
  await Stock.insertMany(stocks);
  res.json({ ok: true });
});

/* ================= SERVER ================= */
app.listen(process.env.PORT || 3000, () =>
  console.log('🚀 Serveur lancé')
);
