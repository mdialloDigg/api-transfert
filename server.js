/******************************************************************
 * APP TRANSFERT – VERSION PRODUCTION RENDER
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();

/* ================= CONFIG ================= */
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'transfert-secret-render',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB Atlas connecté'))
.catch(err => {
  console.error('❌ Erreur MongoDB', err);
  process.exit(1);
});

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: { type: String, default: 'GNF' },
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = String.fromCharCode(65 + Math.random() * 26 | 0) + (100 + Math.random() * 900 | 0);
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
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required><br><br>
    <input type="password" name="password" placeholder="Mot de passe" required><br><br>
    <button>Connexion</button>
  </form>
  `);
});

app.post('/login', async (req, res) => {
  let user = await Auth.findOne({ username: req.body.username });
  if (!user) {
    user = await new Auth({
      username: req.body.username,
      password: bcrypt.hashSync(req.body.password, 10)
    }).save();
  }
  if (!bcrypt.compareSync(req.body.password, user.password)) {
    return res.send('Mot de passe incorrect');
  }
  req.session.user = { id: user._id };
  res.redirect('/transferts');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= TRANSFERT FORM ================= */
app.get('/transferts/new', requireLogin, async (req, res) => {
  const code = await generateUniqueCode();
  res.send(`
  <h2>Nouveau transfert</h2>
  <form method="post">
    <input name="senderFirstName" placeholder="Expéditeur prénom"><br>
    <input name="senderLastName" placeholder="Expéditeur nom"><br>
    <input name="senderPhone" placeholder="Téléphone expéditeur"><br><hr>

    <input name="receiverFirstName" placeholder="Destinataire prénom"><br>
    <input name="receiverLastName" placeholder="Destinataire nom"><br>
    <input name="receiverPhone" placeholder="Téléphone destinataire"><br><hr>

    <input name="amount" placeholder="Montant"><br>
    <input name="fees" placeholder="Frais"><br>
    <input name="currency" value="GNF"><br>
    <input name="code" value="${code}" readonly><br><br>

    <button>Enregistrer</button>
  </form>
  <a href="/transferts">⬅ Retour</a>
  `);
});

app.post('/transferts/new', requireLogin, async (req, res) => {
  const amount = +req.body.amount || 0;
  const fees = +req.body.fees || 0;
  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount: amount - fees
  }).save();
  res.redirect('/transferts');
});

/* ================= LIST ================= */
app.get('/transferts', requireLogin, async (req, res) => {
  const list = await Transfert.find().sort({ createdAt: -1 });
  let html = `<h2>Transferts</h2>
  <a href="/transferts/new">➕ Nouveau</a> |
  <a href="/logout">🚪 Déconnexion</a>
  <table border="1" cellpadding="6">
  <tr><th>Code</th><th>Montant</th><th>Statut</th><th>Actions</th></tr>`;

  list.forEach(t => {
    html += `
    <tr>
      <td>${t.code}</td>
      <td>${t.amount} ${t.currency}</td>
      <td>${t.retired ? 'Retiré' : 'Non retiré'}</td>
      <td>
        <a href="/ticket/${t._id}" target="_blank">🖨</a>
        <a href="/ticket/pdf/${t._id}" target="_blank">📄</a>
      </td>
    </tr>`;
  });

  html += '</table>';
  res.send(html);
});

/* ================= TICKET HTML ================= */
app.get('/ticket/:id', requireLogin, async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  res.send(`
  <body onload="window.print();setTimeout(()=>window.close(),500)">
    <div style="width:260px;border:1px dashed;padding:10px;font-family:Arial">
      <h3 align="center">REÇU TRANSFERT</h3>
      Code: ${t.code}<br>
      Montant: ${t.amount} ${t.currency}<br>
      Frais: ${t.fees}<br>
      À recevoir: ${t.recoveryAmount}<br>
      Date: ${new Date(t.createdAt).toLocaleString()}
    </div>
  </body>
  `);
});

/* ================= TICKET PDF ================= */
app.get('/ticket/pdf/:id', requireLogin, async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  const doc = new PDFDocument({ size: [226, 600], margin: 10 });
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);
  doc.text('AGENCE DE TRANSFERT', { align: 'center' });
  doc.text(`Code: ${t.code}`);
  doc.text(`Montant: ${t.amount} ${t.currency}`);
  doc.text(`Frais: ${t.fees}`);
  doc.text(`À recevoir: ${t.recoveryAmount}`);
  doc.text(new Date(t.createdAt).toLocaleString());
  doc.end();
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Serveur lancé sur le port', PORT));
