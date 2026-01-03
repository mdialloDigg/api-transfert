/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION RENDER READY (FINAL)
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    process.exit(1);
  });

// ================= SESSION =================
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-temporaire',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: { secure: false }
}));

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: String,
  senderFirstName: String,
  receiverFirstName: String,
  senderPhone: String,
  receiverPhone: String,
  destinationLocation: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: String,
  retired: { type: Boolean, default: false },
  retraitHistory: [{ date: Date, mode: String }],
  code: String,
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  code: String,
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  action: String,
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  code: String,
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode() {
  let code;
  do {
    code = String.fromCharCode(65 + Math.random() * 26) + Math.floor(100 + Math.random() * 900);
  } while (
    await Transfert.findOne({ code }) ||
    await Stock.findOne({ code })
  );
  return code;
}

const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login', (req, res) => {
  res.send(`
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Connexion</button>
  </form>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });

  if (!user) {
    user = await new Auth({
      username,
      password: bcrypt.hashSync(password, 10)
    }).save();
  }

  if (!bcrypt.compareSync(password, user.password)) {
    return res.send('Mot de passe incorrect');
  }

  req.session.user = { username };
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });
  const stocks = await Stock.find().sort({ createdAt: -1 });

  let html = `
  <h2>Dashboard</h2>
  <a href="/logout">Déconnexion</a>
  <h3>Transferts</h3>
  <button onclick="newTransfert()">➕ Nouveau</button>
  <table border="1">
  <tr><th>Code</th><th>Expéditeur</th><th>Montant</th><th>Actions</th></tr>`;

  transferts.forEach(t => {
    html += `
    <tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName}</td>
      <td>${t.amount} ${t.currency}</td>
      <td>
        <button onclick="editTransfert('${t._id}')">✏️</button>
        <button onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired ? `<button onclick="retirerTransfert('${t._id}')">💰</button>` : ''}
      </td>
    </tr>`;
  });

  html += `</table>
  <h3>Stocks</h3>
  <button onclick="newStock()">➕ Stock</button>
  <table border="1">
  <tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;

  stocks.forEach(s => {
    html += `
    <tr>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount} ${s.currency}</td>
      <td>
        <button onclick="editStock('${s._id}')">✏️</button>
        <button onclick="deleteStock('${s._id}')">❌</button>
      </td>
    </tr>`;
  });

  html += `
  </table>

<script>
async function post(url,data){
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}

function newTransfert(){
  const sender=prompt('Expéditeur');
  const amount=prompt('Montant');
  post('/transferts/save',{senderFirstName:sender,amount,currency:'GNF'});
  location.reload();
}

function editTransfert(id){
  const amount=prompt('Nouveau montant');
  post('/transferts/save',{_id:id,amount});
  location.reload();
}

function deleteTransfert(id){
  if(confirm('Supprimer ?')) post('/transferts/delete',{id}).then(()=>location.reload());
}

function retirerTransfert(id){
  post('/transferts/retirer',{id,mode:'Espèces'}).then(()=>location.reload());
}

function newStock(){
  const sender=prompt('Expéditeur');
  const dest=prompt('Destination');
  const amount=prompt('Montant');
  post('/stocks/save',{sender,destination:dest,amount,currency:'GNF'}).then(()=>location.reload());
}

function editStock(id){
  const amount=prompt('Nouveau montant');
  post('/stocks/save',{_id:id,amount}).then(()=>location.reload());
}

function deleteStock(id){
  if(confirm('Supprimer ?')) post('/stocks/delete',{id}).then(()=>location.reload());
}
</script>`;

  res.send(html);
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/save', requireLogin, async (req, res) => {
  if (req.body._id) {
    await Transfert.findByIdAndUpdate(req.body._id, req.body);
  } else {
    await new Transfert({
      ...req.body,
      code: await generateUniqueCode()
    }).save();
  }
  res.json({ ok: true });
});

app.post('/transferts/delete', requireLogin, async (req, res) => {
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});

app.post('/transferts/retirer', requireLogin, async (req, res) => {
  await Transfert.findByIdAndUpdate(req.body.id, { retired: true });
  res.json({ ok: true });
});

// ================= STOCK ROUTES =================
app.post('/stocks/save', requireLogin, async (req, res) => {
  if (req.body._id) {
    await Stock.findByIdAndUpdate(req.body._id, req.body);
  } else {
    const code = await generateUniqueCode();
    await new Stock({ ...req.body, code }).save();
    await new StockHistory({ ...req.body, code, action: 'Création' }).save();
  }
  res.json({ ok: true });
});

app.post('/stocks/delete', requireLogin, async (req, res) => {
  const s = await Stock.findByIdAndDelete(req.body.id);
  if (s) await new StockHistory({ ...s.toObject(), action: 'Suppression' }).save();
  res.json({ ok: true });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
