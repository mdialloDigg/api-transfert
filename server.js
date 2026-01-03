/******************************************************************
 * TRANSFERT + STOCK APP – STABLE, CSS, RENDER READY
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => {
    console.error('❌ MongoDB:', err.message);
    process.exit(1);
  });

/* ================= MODELS ================= */
const Transfert = mongoose.model('Transfert', new mongoose.Schema({
  senderFirstName: String,
  receiverFirstName: String,
  amount: Number,
  currency: String,
  retired: { type: Boolean, default: false },
  code: String,
  createdAt: { type: Date, default: Date.now }
}));

const Stock = mongoose.model('Stock', new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  createdAt: { type: Date, default: Date.now }
}));

const StockHistory = mongoose.model('StockHistory', new mongoose.Schema({
  action: String,
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  date: { type: Date, default: Date.now }
}));

const Auth = mongoose.model('Auth', new mongoose.Schema({
  username: String,
  password: String
}));

/* ================= UTILS ================= */
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const genCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

/* ================= LOGIN ================= */
app.get('/login', (req, res) => {
  res.send(`
<style>
body{font-family:Arial;background:#f4f6f8}
form{width:300px;margin:120px auto;padding:20px;background:#fff;border-radius:8px}
input,button{width:100%;padding:10px;margin-top:10px}
button{background:#2d89ef;color:white;border:none}
</style>
<form method="post">
<h3>Connexion</h3>
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
`);
});

app.post('/login', async (req, res) => {
  let user = await Auth.findOne({ username: req.body.username });
  if (!user) {
    user = await Auth.create({
      username: req.body.username,
      password: bcrypt.hashSync(req.body.password, 10)
    });
  }
  if (!bcrypt.compareSync(req.body.password, user.password)) {
    return res.send('Mot de passe incorrect');
  }
  req.session.user = user.username;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async (req, res) => {
  const stocks = await Stock.find().sort({ createdAt: -1 });
  const history = await StockHistory.find().sort({ date: -1 });

  res.send(`
<!DOCTYPE html>
<html>
<head>
<style>
body{font-family:Arial;background:#eef2f5;padding:20px}
h2{margin-bottom:5px}
table{width:100%;border-collapse:collapse;background:#fff;margin-bottom:30px}
th,td{border:1px solid #ddd;padding:8px;text-align:center}
th{background:#2d89ef;color:white}
button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer}
.add{background:#28a745;color:white}
.edit{background:#ffc107}
.del{background:#dc3545;color:white}
.top{display:flex;justify-content:space-between;align-items:center}
</style>
</head>
<body>

<div class="top">
<h2>Gestion des Stocks</h2>
<a href="/logout">Déconnexion</a>
</div>

<h3>Ajouter un stock</h3>
<form onsubmit="addStock(event)">
<input id="sender" placeholder="Expéditeur" required>
<input id="destination" placeholder="Destination" required>
<input id="amount" type="number" placeholder="Montant" required>
<button class="add">Ajouter</button>
</form>

<h3>Stocks</h3>
<table>
<tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>
${stocks.map(s => `
<tr>
<td>${s.sender}</td>
<td>${s.destination}</td>
<td>${s.amount} ${s.currency}</td>
<td>
<button class="edit" onclick="editStock('${s._id}',${s.amount})">✏️</button>
<button class="del" onclick="deleteStock('${s._id}')">❌</button>
</td>
</tr>
`).join('')}
</table>

<h3>Historique des stocks</h3>
<table>
<tr><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Date</th></tr>
${history.map(h => `
<tr>
<td>${h.action}</td>
<td>${h.sender}</td>
<td>${h.destination}</td>
<td>${h.amount} ${h.currency}</td>
<td>${new Date(h.date).toLocaleString()}</td>
</tr>
`).join('')}
</table>

<script>
async function addStock(e){
  e.preventDefault();
  await fetch('/stocks/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      sender:sender.value,
      destination:destination.value,
      amount:+amount.value,
      currency:'GNF'
    })
  });
  location.reload();
}

function editStock(id,amt){
  const n = prompt('Nouveau montant',amt);
  if(n) fetch('/stocks/save',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({_id:id,amount:+n})
  }).then(()=>location.reload());
}

function deleteStock(id){
  if(confirm('Supprimer ?'))
    fetch('/stocks/delete',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id})
    }).then(()=>location.reload());
}
</script>

</body>
</html>
`);
});

/* ================= STOCK ROUTES ================= */
app.post('/stocks/save', requireLogin, async (req, res) => {
  if (req.body._id) {
    await Stock.findByIdAndUpdate(req.body._id, { amount: req.body.amount });
  } else {
    const s = await Stock.create(req.body);
    await StockHistory.create({
      action: 'Ajout',
      sender: s.sender,
      destination: s.destination,
      amount: s.amount,
      currency: s.currency
    });
  }
  res.json({ ok: true });
});

app.post('/stocks/delete', requireLogin, async (req, res) => {
  const s = await Stock.findByIdAndDelete(req.body.id);
  if (s) {
    await StockHistory.create({
      action: 'Suppression',
      sender: s.sender,
      destination: s.destination,
      amount: s.amount,
      currency: s.currency
    });
  }
  res.json({ ok: true });
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Serveur lancé sur', PORT));
