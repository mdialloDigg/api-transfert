/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION FINALE FONCTIONNELLE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert')
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error(err); process.exit(1); });

/* ================= SCHEMAS ================= */
const Transfert = mongoose.model('Transfert', new mongoose.Schema({
  senderFirstName: String,
  receiverFirstName: String,
  amount: Number,
  currency: String,
  fees: Number,
  recoveryAmount: Number,
  retired: { type: Boolean, default: false },
  retraitHistory: [{ date: Date, mode: String }],
  code: String,
  createdAt: { type: Date, default: Date.now }
}));

const Stock = mongoose.model('Stock', new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  code: String,
  createdAt: { type: Date, default: Date.now }
}));

const StockHistory = mongoose.model('StockHistory', new mongoose.Schema({
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  code: String,
  date: { type: Date, default: Date.now }
}));

const Auth = mongoose.model('Auth', new mongoose.Schema({
  username: String,
  password: String
}));

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = String.fromCharCode(65 + Math.random() * 26) + Math.floor(100 + Math.random() * 900);
    exists = await Transfert.findOne({ code }) || await Stock.findOne({ code });
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
  <form method="post" style="margin:100px auto;width:300px">
    <h3>Connexion</h3>
    <input name="username" placeholder="Utilisateur" required><br><br>
    <input type="password" name="password" placeholder="Mot de passe" required><br><br>
    <button>Connexion</button>
  </form>
  `);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if (!user) user = await new Auth({ username, password: bcrypt.hashSync(password, 10) }).save();
  if (!bcrypt.compareSync(password, user.password)) return res.send('Erreur mot de passe');
  req.session.user = user;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });
  const stocks = await Stock.find().sort({ createdAt: -1 });
  const history = await StockHistory.find().sort({ date: -1 });

  let html = `
  <h2>Dashboard</h2>
  <a href="/logout">Déconnexion</a>

  <h3>Transferts</h3>
  <table border="1" cellpadding="5">
  <tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Actions</th></tr>`;

  transferts.forEach(t => {
    html += `
    <tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName}</td>
      <td>${t.receiverFirstName}</td>
      <td>${t.amount} ${t.currency}</td>
      <td>
        <button type="button" onclick="editTransfert('${t._id}')">✏️</button>
        <button type="button" onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired ? `<button type="button" onclick="retirerTransfert('${t._id}')">💰</button>` : ''}
      </td>
    </tr>`;
  });

  html += `</table>

  <h3>Stocks</h3>
  <table border="1" cellpadding="5">
  <tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;

  stocks.forEach(s => {
    html += `
    <tr>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount} ${s.currency}</td>
      <td>
        <button type="button" onclick="editStock('${s._id}')">✏️</button>
        <button type="button" onclick="deleteStock('${s._id}')">❌</button>
      </td>
    </tr>`;
  });

  html += `</table>

  <h3>Historique Stocks</h3>
  <table border="1" cellpadding="5">
  <tr><th>Date</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;

  history.forEach(h => {
    html += `
    <tr>
      <td>${h.date.toLocaleString()}</td>
      <td>${h.action}</td>
      <td>${h.sender}</td>
      <td>${h.destination}</td>
      <td>${h.amount} ${h.currency}</td>
    </tr>`;
  });

  html += `</table>

<script>
async function post(url,data){
  await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  location.reload();
}
async function editTransfert(id){
  const t = await (await fetch('/transferts/get/'+id)).json();
  const a = prompt('Montant',t.amount);
  if(a) post('/transferts/form',{_id:id,amount:a});
}
function deleteTransfert(id){ if(confirm('Supprimer ?')) post('/transferts/delete',{id}); }
function retirerTransfert(id){ const m=prompt('Mode'); if(m) post('/transferts/retirer',{id,mode:m}); }
async function editStock(id){
  const s = await (await fetch('/stocks/get/'+id)).json();
  const a = prompt('Montant',s.amount);
  if(a) post('/stocks/new',{_id:id,amount:a});
}
function deleteStock(id){ if(confirm('Supprimer stock ?')) post('/stocks/delete',{id}); }
</script>
`;

  res.send(html);
});

/* ================= TRANSFERT ROUTES ================= */
app.post('/transferts/form', requireLogin, async (req, res) => {
  if (req.body._id) await Transfert.findByIdAndUpdate(req.body._id, req.body);
  else await new Transfert({ ...req.body, code: await generateUniqueCode() }).save();
  res.json({ ok: true });
});
app.post('/transferts/delete', requireLogin, async (req, res) => {
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});
app.post('/transferts/retirer', requireLogin, async (req, res) => {
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.json({ ok: true });
});
app.get('/transferts/get/:id', requireLogin, async (req, res) => res.json(await Transfert.findById(req.params.id)));

/* ================= STOCK ROUTES ================= */
app.post('/stocks/new', requireLogin, async (req, res) => {
  if (req.body._id) await Stock.findByIdAndUpdate(req.body._id, req.body);
  else await new Stock({ ...req.body, code: await generateUniqueCode() }).save();
  res.json({ ok: true });
});
app.post('/stocks/delete', requireLogin, async (req, res) => {
  const s = await Stock.findByIdAndDelete(req.body.id);
  if (s) await new StockHistory({ action:'Suppression', ...s.toObject() }).save();
  res.json({ ok: true });
});
app.get('/stocks/get/:id', requireLogin, async (req, res) => res.json(await Stock.findById(req.params.id)));

/* ================= SERVER ================= */
app.listen(3000, () => console.log('🚀 http://localhost:3000'));
