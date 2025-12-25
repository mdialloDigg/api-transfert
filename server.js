/******************************************************************
 * APP TRANSFERT — VERSION FINALE DÉFINITIVE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => {
  console.error('❌ MongoDB erreur:', err.message);
  process.exit(1);
});

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

const Auth = mongoose.model('Auth', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}));

/* ================= UTILS ================= */
const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

async function generateCode() {
  let code, exist = true;
  while (exist) {
    code = Math.random().toString(36).substring(2, 7).toUpperCase();
    exist = await Transfert.findOne({ code });
  }
  return code;
}

/* ================= LOGIN ================= */
app.get('/login', (req, res) => {
  res.send(`
  <form method="post">
    <h2>Connexion</h2>
    <input name="username" placeholder="Utilisateur" required><br>
    <input type="password" name="password" placeholder="Mot de passe" required><br>
    <button>Connexion</button>
  </form>
  `);
});

app.post('/login', async (req, res) => {
  let u = await Auth.findOne({ username: req.body.username });
  if (!u) {
    u = await new Auth({
      username: req.body.username,
      password: bcrypt.hashSync(req.body.password, 10)
    }).save();
  }
  if (!bcrypt.compareSync(req.body.password, u.password))
    return res.send('Mot de passe incorrect');

  req.session.user = u.username;
  res.redirect('/transferts/list');
});

/* ================= FORM ================= */
app.get('/transferts/form', requireLogin, async (req, res) => {
  const t = req.query.code ? await Transfert.findOne({ code: req.query.code }) : null;
  const code = t ? t.code : await generateCode();

  res.send(`
  <form method="post">
    <h2>${t ? 'Modifier' : 'Nouveau'} transfert</h2>

    <input name="userType" placeholder="Type utilisateur" value="${t?.userType||''}" required><br>

    <h3>Expéditeur</h3>
    <input name="senderFirstName" placeholder="Prénom" value="${t?.senderFirstName||''}" required>
    <input name="senderLastName" placeholder="Nom" value="${t?.senderLastName||''}" required>
    <input name="senderPhone" placeholder="Téléphone" value="${t?.senderPhone||''}" required>
    <input name="originLocation" placeholder="Origine" value="${t?.originLocation||''}" required>

    <h3>Destinataire</h3>
    <input name="receiverFirstName" placeholder="Prénom" value="${t?.receiverFirstName||''}" required>
    <input name="receiverLastName" placeholder="Nom" value="${t?.receiverLastName||''}" required>
    <input name="receiverPhone" placeholder="Téléphone" value="${t?.receiverPhone||''}" required>
    <input name="destinationLocation" placeholder="Destination" value="${t?.destinationLocation||''}" required>

    <h3>Montants</h3>
    <input name="amount" type="number" placeholder="Montant" value="${t?.amount||''}" required>
    <input name="fees" type="number" placeholder="Frais" value="${t?.fees||''}" required>
    <input name="currency" placeholder="Devise" value="${t?.currency||''}" required>

    <input type="hidden" name="code" value="${code}">
    <button>Enregistrer</button>
  </form>
  `);
});

app.post('/transferts/form', requireLogin, async (req, res) => {
  const amount = Number(req.body.amount);
  const fees = Number(req.body.fees);
  const recoveryAmount = amount - fees;

  const data = { ...req.body, amount, fees, recoveryAmount };

  const exist = await Transfert.findOne({ code: req.body.code });
  if (exist) await Transfert.updateOne({ _id: exist._id }, data);
  else await new Transfert(data).save();

  res.redirect('/transferts/list');
});

/* ================= LIST ================= */
app.get('/transferts/list', requireLogin, async (req, res) => {

  let all = await Transfert.find().sort({ destinationLocation: 1, createdAt: -1 });

  if (req.query.destination && req.query.destination !== 'all')
    all = all.filter(t => t.destinationLocation === req.query.destination);

  if (req.query.status === 'retired') all = all.filter(t => t.retired);
  if (req.query.status === 'not_retired') all = all.filter(t => !t.retired);

  const destinations = [...new Set((await Transfert.find()).map(t => t.destinationLocation))];

  const grouped = {};
  all.forEach(t => {
    if (!grouped[t.destinationLocation]) grouped[t.destinationLocation] = [];
    grouped[t.destinationLocation].push(t);
  });

  res.send(`
  <h1>Liste des transferts</h1>

  <form>
    <select name="destination">
      <option value="all">Toutes destinations</option>
      ${destinations.map(d=>`<option ${req.query.destination===d?'selected':''}>${d}</option>`).join('')}
    </select>

    <select name="status">
      <option value="">Tous</option>
      <option value="retired">Retiré</option>
      <option value="not_retired">Non retiré</option>
    </select>

    <button>Filtrer</button>
  </form>

  ${Object.keys(grouped).map(dest=>`
    <h2>${dest}</h2>
    ${grouped[dest].map(t=>`
      <div style="border:1px solid #ccc;padding:10px;margin:10px">
        <b>Code:</b> ${t.code}<br>
        <b>Expéditeur:</b> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})<br>
        <b>Destinataire:</b> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})<br>
        <b>Montant:</b> ${t.amount} ${t.currency} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount}<br>
        <b>Statut:</b> ${t.retired ? 'Retiré' : 'Non retiré'}<br>

        <a href="/transferts/print/${t._id}" target="_blank">🖨️ Imprimer</a>
      </div>
    `).join('')}
  `).join('')}
  `);
});

/* ================= PRINT ================= */
app.get('/transferts/print/:id', requireLogin, async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  res.send(`
  <body onload="print()">
  <h3>TICKET DE TRANSFERT</h3>
  Code: ${t.code}<br>
  Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})<br>
  Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})<br>
  Destination: ${t.destinationLocation}<br>
  Montant: ${t.amount} ${t.currency}<br>
  Frais: ${t.fees}<br>
  À recevoir: ${t.recoveryAmount}<br>
  Statut: ${t.retired ? 'Retiré' : 'Non retiré'}<br>
  Date: ${new Date(t.createdAt).toLocaleString()}
  </body>
  `);
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log('🚀 Serveur lancé sur le port', PORT)
);
