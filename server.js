/******************************************************************
 * TRANSFERT + STOCK APP – STABLE + ERREURS + CSS + RENDER READY
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ================= SESSION ================= */
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => {
  console.error('❌ MongoDB indisponible:', err.message);
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

/* ================= LOGIN ================= */
app.get('/login', (req, res) => {
  res.send(`
<style>
body{font-family:Arial;background:#f4f6f8}
form{width:320px;margin:120px auto;padding:20px;background:#fff;border-radius:8px}
input,button{width:100%;padding:10px;margin-top:10px}
button{background:#2d89ef;color:white;border:none}
.error{color:red;text-align:center}
</style>
<form method="post">
<h3>Connexion</h3>
${req.query.err ? `<div class="error">${req.query.err}</div>` : ''}
<input name="username" required placeholder="Utilisateur">
<input type="password" name="password" required placeholder="Mot de passe">
<button>Se connecter</button>
</form>
`);
});

app.post('/login', async (req, res) => {
  try {
    let user = await Auth.findOne({ username: req.body.username });
    if (!user) {
      user = await Auth.create({
        username: req.body.username,
        password: bcrypt.hashSync(req.body.password, 10)
      });
    }
    if (!bcrypt.compareSync(req.body.password, user.password)) {
      return res.redirect('/login?err=Mot de passe incorrect');
    }
    req.session.user = user.username;
    res.redirect('/dashboard');
  } catch (e) {
    res.redirect('/login?err=Erreur serveur');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async (req, res) => {
  try {
    const stocks = await Stock.find().sort({ createdAt: -1 });
    const history = await StockHistory.find().sort({ date: -1 });

    res.send(`
<!DOCTYPE html>
<html>
<head>
<style>
body{font-family:Arial;background:#eef2f5;padding:20px}
table{width:100%;border-collapse:collapse;background:#fff;margin-bottom:30px}
th,td{border:1px solid #ddd;padding:8px;text-align:center}
th{background:#2d89ef;color:white}
button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer}
.add{background:#28a745;color:white}
.edit{background:#ffc107}
.del{background:#dc3545;color:white}
.error{background:#dc3545;color:white;padding:10px;margin-bottom:15px}
</style>
</head>
<body>

<h2>Gestion des stocks</h2>
<a href="/logout">Déconnexion</a>

<div id="errorBox" class="error" style="display:none"></div>

<form onsubmit="addStock(event)">
<input id="sender" placeholder="Expéditeur" required>
<input id="destination" placeholder="Destination" required>
<input id="amount" type="number" placeholder="Montant" required>
<button class="add">Ajouter</button>
</form>

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

<h3>Historique</h3>
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
function showError(msg){
  const box=document.getElementById('errorBox');
  box.innerText=msg;
  box.style.display='block';
}

async function api(url,data){
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const j=await r.json();
    if(!j.ok) throw j.message;
    location.reload();
  }catch(e){
    showError(e || 'Erreur serveur (502)');
  }
}

function addStock(e){
  e.preventDefault();
  api('/stocks/save',{sender:sender.value,destination:destination.value,amount:+amount.value,currency:'GNF'});
}

function editStock(id,a){
  const n=prompt('Nouveau montant',a);
  if(n) api('/stocks/save',{_id:id,amount:+n});
}

function deleteStock(id){
  if(confirm('Supprimer ?')) api('/stocks/delete',{id});
}
</script>

</body>
</html>
`);
  } catch (e) {
    res.status(502).send('<h2>Bad Gateway – Base de données indisponible</h2>');
  }
});

/* ================= STOCK ROUTES ================= */
app.post('/stocks/save', requireLogin, async (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ ok: false, message: 'Erreur enregistrement stock' });
  }
});

app.post('/stocks/delete', requireLogin, async (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ ok: false, message: 'Erreur suppression stock' });
  }
});

/* ================= GLOBAL ERROR ================= */
app.use((err, req, res, next) => {
  console.error('🔥 ERREUR GLOBALE:', err);
  res.status(502).send('Bad Gateway');
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Serveur prêt sur', PORT));
