/******************************************************************
 * APP STOCK + TRANSFERT
 * FINAL – UN SEUL FICHIER – RENDER SAFE – NODE 20
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

/* ===================== MIDDLEWARE ===================== */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ===================== SESSION (SAFE PROD) ===================== */
app.use(session({
  secret: 'render-secret',
  resave: false,
  saveUninitialized: false,
  store: MONGO_URI
    ? MongoStore.create({ mongoUrl: MONGO_URI })
    : undefined
}));

/* ===================== MONGODB (NO CRASH) ===================== */
let mongoReady = false;

if (MONGO_URI) {
  mongoose.set('bufferCommands', false);
  mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      mongoReady = true;
      console.log('✅ MongoDB connecté');
    })
    .catch(err => {
      console.error('❌ MongoDB ERROR:', err.message);
    });
} else {
  console.warn('⚠️ MONGO_URI non défini – mode sans base activé');
}

/* ===================== MODELS (SI DB OK) ===================== */
let Auth, Stock, Transfer;

if (MONGO_URI) {
  Auth = mongoose.model('Auth', new mongoose.Schema({
    username: { type: String, unique: true },
    password: String
  }));

  Stock = mongoose.model('Stock', new mongoose.Schema({
    sender: String,
    destination: String,
    amount: Number,
    currency: String,
    createdAt: { type: Date, default: Date.now }
  }));

  Transfer = mongoose.model('Transfer', new mongoose.Schema({
    sender: String,
    receiver: String,
    amount: Number,
    currency: String,
    code: String,
    createdAt: { type: Date, default: Date.now }
  }));
}

/* ===================== MIDDLEWARE DB CHECK ===================== */
const requireDB = (req, res, next) => {
  if (!mongoReady) {
    return res.send(`
      <h2>❌ Base de données non configurée</h2>
      <p>Ajoute <b>MONGO_URI</b> dans Render → Environment</p>
    `);
  }
  next();
};

/* ===================== AUTH ===================== */
const auth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

app.get('/login', (req, res) => {
  if (!mongoReady) return res.redirect('/');
  res.send(`
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" required placeholder="Utilisateur"><br>
      <input name="password" required placeholder="Mot de passe"><br>
      <button>Connexion</button>
    </form>
  `);
});

app.post('/login', requireDB, async (req, res) => {
  let user = await Auth.findOne({ username: req.body.username });
  if (!user) user = await Auth.create(req.body);
  req.session.user = user;
  res.redirect('/');
});

/* ===================== DASHBOARD ===================== */
app.get('/', async (req, res) => {
  if (!mongoReady) {
    return res.send(`
      <h1>⚠️ Application en attente</h1>
      <p>MONGO_URI n'est pas défini.</p>
      <p>Ajoute-le dans <b>Render → Environment</b></p>
    `);
  }

  const stocks = await Stock.find();
  const transfers = await Transfer.find();

  res.send(`
<h2>Stocks</h2>
<ul>${stocks.map(s => `<li>${s.sender} → ${s.destination}</li>`).join('')}</ul>

<h2>Transferts</h2>
<ul>${transfers.map(t => `<li>${t.code} : ${t.amount} ${t.currency}</li>`).join('')}</ul>

<a href="/export/pdf">PDF</a> | <a href="/export/excel">Excel</a>
  `);
});

/* ===================== API ===================== */
app.post('/transfer', requireDB, auth, async (req, res) => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await Transfer.create({ sender: 'Client', receiver: 'Agence', amount: 100, currency: 'GNF', code });
  res.json({ ok: true });
});

/* ===================== EXPORT PDF ===================== */
app.get('/export/pdf', requireDB, auth, async (req, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Disposition', 'attachment; filename=transferts.pdf');
  doc.pipe(res);
  (await Transfer.find()).forEach(t =>
    doc.text(`${t.code} - ${t.amount} ${t.currency}`)
  );
  doc.end();
});

/* ===================== EXPORT EXCEL ===================== */
app.get('/export/excel', requireDB, auth, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transferts');
  ws.addRow(['Code', 'Amount', 'Currency']);
  (await Transfer.find()).forEach(t => ws.addRow([t.code, t.amount, t.currency]));
  res.setHeader('Content-Disposition', 'attachment; filename=transferts.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

/* ===================== SERVER ===================== */
app.listen(PORT, () => {
  console.log('🚀 Serveur actif sur le port ' + PORT);
});
