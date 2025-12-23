/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error(err));

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  amount: Number,
  fees: Number,
  feePercent: Number,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  recoveryAmount: Number,
  recoveryMode: String,
  code: String,
  status: { type: String, default: 'actif' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const authUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

/* ================= AUTH MIDDLEWARE ================= */
function requireLogin(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

/* ================= AUTH ================= */
app.get('/login', (req, res) => {
  res.send(`
  <html><body style="text-align:center;font-family:Arial;padding-top:60px">
  <h2>🔑 Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required><br><br>
    <input name="password" type="password" placeholder="Mot de passe" required><br><br>
    <button>Connexion</button>
  </form>
  <a href="/register">Créer un compte</a>
  </body></html>
  `);
});

app.post('/login', async (req, res) => {
  const u = await AuthUser.findOne({ username: req.body.username });
  if (!u) return res.send("Utilisateur inconnu");
  const ok = await bcrypt.compare(req.body.password, u.password);
  if (!ok) return res.send("Mot de passe incorrect");
  req.session.userId = u._id;
  res.redirect('/users');
});

app.get('/register', (req, res) => {
  res.send(`
  <html><body style="text-align:center;font-family:Arial;padding-top:60px">
  <h2>📝 Inscription</h2>
  <form method="post">
    <input name="username" required><br><br>
    <input name="password" type="password" required><br><br>
    <button>Créer</button>
  </form>
  </body></html>
  `);
});

app.post('/register', async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10);
  await new AuthUser({ username: req.body.username, password: hash }).save();
  res.redirect('/login');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= ACCÈS FORM ================= */
app.get('/users', requireLogin, (req, res) => {
  if (!req.session.formAccess) {
    return res.send(`
    <form method="post" action="/auth/form" style="text-align:center;padding-top:60px">
      <input type="password" name="code" placeholder="Code 123">
      <button>Valider</button>
    </form>`);
  }
  res.redirect('/users/choice');
});

app.post('/auth/form', (req, res) => {
  if (req.body.code === '123') req.session.formAccess = true;
  res.redirect('/users/choice');
});

/* ================= CHOIX ================= */
app.get('/users/choice', requireLogin, (req, res) => {
  res.send(`
  <html><body style="text-align:center;font-family:Arial;padding-top:50px">
  <a href="/users/lookup?mode=new">➕ Nouveau</a><br><br>
  <a href="/users/lookup?mode=edit">✏️ Modifier</a><br><br>
  <a href="/users/lookup?mode=delete">❌ Supprimer</a><br><br>
  <a href="/users/all">📋 Liste</a><br><br>
  <a href="/logout">🚪 Déconnexion</a>
  </body></html>
  `);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup', requireLogin, (req, res) => {
  req.session.choiceMode = req.query.mode;
  res.send(`
  <form method="post" style="text-align:center;padding-top:60px">
    <input name="phone" placeholder="Téléphone expéditeur" required>
    <button>Continuer</button>
  </form>
  `);
});

app.post('/users/lookup', requireLogin, async (req, res) => {
  const u = await User.findOne({ senderPhone: req.body.phone }).sort({ createdAt: -1 });
  req.session.prefill = u || { senderPhone: req.body.phone };
  req.session.editId = u ? u._id : null;

  if (req.session.choiceMode === 'delete' && u) {
    await User.findByIdAndDelete(u._id);
    return res.send("❌ Supprimé <a href='/users/choice'>Retour</a>");
  }
  res.redirect('/users/form');
});

/* ================= FORM ================= */
app.get('/users/form', requireLogin, (req, res) => {
  const u = req.session.prefill || {};
  res.send(`
  <html><body style="font-family:Arial">
  <form id="f">
    <input id="senderPhone" value="${u.senderPhone || ''}" placeholder="Téléphone" required><br>
    <input id="amount" type="number" placeholder="Montant"><br>
    <input id="fees" type="number" placeholder="Frais"><br>
    <input id="recoveryAmount" readonly placeholder="Reçu"><br>
    <button>Enregistrer</button>
  </form>
  <script>
    amount.oninput = fees.oninput = ()=>recoveryAmount.value=(+amount.value||0)-(+fees.value||0);
    f.onsubmit=async e=>{
      e.preventDefault();
      const r=await fetch('/users',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        senderPhone:senderPhone.value,
        amount:+amount.value,
        fees:+fees.value,
        recoveryAmount:+recoveryAmount.value
      })});
      alert((await r.json()).message);
    }
  </script>
  </body></html>
  `);
});

/* ================= CRUD ================= */
app.post('/users', requireLogin, async (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await new User({ ...req.body, code }).save();
  res.json({ message: '✅ Enregistré | Code ' + code });
});

/* ================= LISTE ================= */
app.get('/users/all', requireLogin, async (req, res) => {
  const users = await User.find();
  let rows = users.map(u => `
  <tr class="${u.retired ? 'retired' : ''}">
    <td>${u.senderPhone}</td>
    <td>${u.amount}</td>
    <td>${u.recoveryAmount}</td>
    <td>${
      u.retired
        ? 'Retiré'
        : `<select onchange="retirer(this,'${u._id}',this.closest('tr'))">
            <option value="">💰 Retirer</option>
            <option>Espèces</option>
            <option>Orange Money</option>
            <option>Produit</option>
            <option>Service</option>
           </select>`
    }</td>
  </tr>`).join('');

  res.send(`
  <html><body>
  <table border="1">
    <tr><th>Tél</th><th>Montant</th><th>Reçu</th><th>Action</th></tr>
    ${rows}
  </table>
  <script>
  async function retirer(sel,id,row){
    const mode=sel.value;
    if(!mode) return;
    await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,mode})});
    row.classList.add('retired');
    sel.outerHTML='Retiré';
  }
  </script>
  </body></html>
  `);
});

/* ================= RETRAIT ================= */
app.post('/users/retirer', requireLogin, async (req, res) => {
  const u = await User.findById(req.body.id);
  u.retired = true;
  u.recoveryMode = req.body.mode;
  u.retraitHistory.push({ date: new Date(), mode: req.body.mode });
  await u.save();
  res.json({ message: 'Retrait effectué' });
});

/* ================= PDF ================= */
app.get('/users/export/pdf', requireLogin, async (req, res) => {
  const users = await User.find();
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  doc.pipe(res);
  users.forEach(u=>{
    doc.text(`Téléphone: ${u.senderPhone} | Montant: ${u.amount}`);
    doc.moveDown();
  });
  doc.end();
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log('🚀 Serveur lancé sur', PORT)
);
