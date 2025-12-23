/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session); // v3 syntax
const cors = require('cors');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test')
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(console.error);

/* ================= SESSION (Render-safe v3) ================= */
app.use(session({
  name: 'transfert.sid',
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false,
  store: new MongoStore({
    url: process.env.MONGODB_URI || 'mongodb://localhost:27017/test',
    collection: 'sessions'
  }),
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 12
  }
}));

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
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

/* ================= AUTH MIDDLEWARE ================= */
function requireLogin(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

/* ================= AUTH ROUTES ================= */
app.get('/login', (req, res) => {
  res.send(`<form method="post">
    <input name="username" placeholder="Username" required>
    <input name="password" type="password" placeholder="Password" required>
    <button>Login</button>
  </form>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await AuthUser.findOne({ username });
  if (!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Mot de passe incorrect");
  req.session.userId = user._id;
  res.redirect('/users/all');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= RETRAIT ================= */
app.post('/users/retirer', requireLogin, async (req, res) => {
  const { id, mode } = req.body;
  if (!["Espèces", "Orange Money", "Produit", "Service"].includes(mode))
    return res.status(400).json({ message: "Mode invalide" });

  const user = await User.findById(id);
  if (!user) return res.status(404).json({ message: "Transfert introuvable" });

  if (user.retired) return res.json({ message: "Déjà retiré" });

  user.retired = true;
  user.recoveryMode = mode;
  user.retraitHistory.push({ date: new Date(), mode });
  await user.save();

  res.json({ message: `💰 Retrait effectué via ${mode}` });
});

/* ================= LISTE ================= */
app.get('/users/all', requireLogin, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });

  let html = `
  <html><head><style>
    table{width:95%;margin:auto;border-collapse:collapse}
    td,th{border:1px solid #ccc;padding:6px;text-align:center}
    tr.retired{background:orange}
    select{padding:5px}
  </style></head><body>
  <h2 style="text-align:center">📋 Liste des transferts</h2>
  <table>
    <tr><th>Nom</th><th>Montant</th><th>Code</th><th>Action</th></tr>`;

  users.forEach(u => {
    html += `
    <tr class="${u.retired ? 'retired' : ''}">
      <td>${u.senderFirstName || ''}</td>
      <td>${u.amount || 0}</td>
      <td>${u.code || ''}</td>
      <td>
        ${u.retired ? 'Montant retiré' : `
          <select onchange="retirer('${u._id}', this)">
            <option value="">💰 Retirer...</option>
            <option>Espèces</option>
            <option>Orange Money</option>
            <option>Produit</option>
            <option>Service</option>
          </select>`}
      </td>
    </tr>`;
  });

  html += `
  </table>
  <script>
    async function retirer(id, sel) {
      if(!sel.value) return;
      const res = await fetch('/users/retirer', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({id, mode: sel.value})
      });
      const data = await res.json();
      alert(data.message);
      sel.closest('tr').classList.add('retired');
      sel.outerHTML = 'Montant retiré';
    }
  </script>
  </body></html>`;

  res.send(html);
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));
