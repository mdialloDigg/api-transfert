/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION FINALE RENDER (SANS CONNECT-MONGO)
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => {
  console.error('❌ MongoDB erreur:', err.message);
  process.exit(1);
});

// ================= SESSION (SANS connect-mongo) =================
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-temp',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  senderFirstName: String,
  receiverFirstName: String,
  amount: Number,
  currency: { type: String, default: 'GNF' },
  retired: { type: Boolean, default: false },
  retraitHistory: [{ date: Date, mode: String }],
  code: String,
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: { type: String, default: 'GNF' },
  code: String,
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILS =================
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const genCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

// ================= LOGIN =================
app.get('/login', (req, res) => {
  res.send(`
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required><br>
    <input type="password" name="password" placeholder="Mot de passe" required><br>
    <button>Connexion</button>
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
  req.session.user = { username: user.username };
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });
  const stocks = await Stock.find().sort({ createdAt: -1 });

  res.send(`
<!DOCTYPE html>
<html>
<body>
<h2>📊 Dashboard</h2>
<a href="/logout">Déconnexion</a>

<h3>Transferts</h3>
<button onclick="newTransfert()">➕</button>
<table border="1">
${transferts.map(t => `
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName}</td>
<td>${t.receiverFirstName}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired ? 'Retiré' : 'Non retiré'}</td>
<td>
<button onclick="editTransfert('${t._id}')">✏️</button>
<button onclick="deleteTransfert('${t._id}')">❌</button>
${!t.retired ? `<button onclick="retirerTransfert('${t._id}')">💰</button>` : ''}
</td>
</tr>`).join('')}
</table>

<h3>Stocks</h3>
<button onclick="newStock()">➕</button>
<table border="1">
${stocks.map(s => `
<tr>
<td>${s.sender}</td>
<td>${s.destination}</td>
<td>${s.amount}</td>
<td>${s.currency}</td>
<td>
<button onclick="editStock('${s._id}')">✏️</button>
<button onclick="deleteStock('${s._id}')">❌</button>
</td>
</tr>`).join('')}
</table>

<script>
async function post(url,data){
  await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  });
  location.reload();
}

function newTransfert(){
  post('/transferts/save',{
    senderFirstName:prompt('Expéditeur'),
    receiverFirstName:prompt('Destinataire'),
    amount:+prompt('Montant')
  });
}
function editTransfert(id){
  post('/transferts/save',{_id:id,amount:+prompt('Nouveau montant')});
}
function deleteTransfert(id){
  if(confirm('Supprimer ?')) post('/transferts/delete',{id});
}
function retirerTransfert(id){
  post('/transferts/retirer',{id,mode:'Espèces'});
}

function newStock(){
  post('/stocks/save',{
    sender:prompt('Expéditeur'),
    destination:prompt('Destination'),
    amount:+prompt('Montant')
  });
}
function editStock(id){
  post('/stocks/save',{_id:id,amount:+prompt('Nouveau montant')});
}
function deleteStock(id){
  if(confirm('Supprimer ?')) post('/stocks/delete',{id});
}
</script>
</body>
</html>
`);
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/save', requireLogin, async (req, res) => {
  if (req.body._id) {
    await Transfert.findByIdAndUpdate(req.body._id, req.body);
  } else {
    await Transfert.create({ ...req.body, code: genCode() });
  }
  res.json({ ok: true });
});

app.post('/transferts/delete', requireLogin, async (req, res) => {
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});

app.post('/transferts/retirer', requireLogin, async (req, res) => {
  await Transfert.findByIdAndUpdate(req.body.id, {
    retired: true,
    $push: { retraitHistory: { date: new Date(), mode: req.body.mode } }
  });
  res.json({ ok: true });
});

// ================= STOCK ROUTES =================
app.post('/stocks/save', requireLogin, async (req, res) => {
  if (req.body._id) {
    await Stock.findByIdAndUpdate(req.body._id, req.body);
  } else {
    await Stock.create({ ...req.body, code: genCode() });
  }
  res.json({ ok: true });
});

app.post('/stocks/delete', requireLogin, async (req, res) => {
  await Stock.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('🚀 Serveur lancé sur le port', PORT));
