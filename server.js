/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN COMPLETE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: true, saveUninitialized: true }));

/* ================= DATABASE ================= */
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("❌ MONGO_URI non défini. Mets ton URI MongoDB Atlas dans les variables d'environnement.");
  process.exit(1);
}
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error("❌ Impossible de se connecter à MongoDB :", err); process.exit(1); });

/* ================= CONSTANTES ================= */
const locations = ['France', 'Belgique', 'Conakry', 'Suisse', 'Atlanta', 'New York', 'Allemagne'];
const currencies = ['GNF', 'EUR', 'USD', 'XOF'];
const retraitModes = ['Espèces', 'Virement', 'Orange Money', 'Wave'];
const userTypes = ['Client', 'Distributeur', 'Administrateur', 'Agence de transfert'];

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({ username: String, password: String });
const User = mongoose.model('User', userSchema);

const transfertSchema = new mongoose.Schema({
  userType: String,
  senderFirstName: String, senderLastName: String, senderPhone: String, originLocation: String,
  receiverFirstName: String, receiverLastName: String, receiverPhone: String, destinationLocation: String,
  amount: Number, fees: Number, recoveryAmount: Number, currency: String, recoveryMode: String,
  retired: { type: Boolean, default: false }, code: { type: String, unique: true }, retraitHistory: [{ date: Date, mode: String }],
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  location: String, currency: String, balance: { type: Number, default: 0 }
});
stockSchema.index({ location: 1, currency: 1 }, { unique: true });
const Stock = mongoose.model('Stock', stockSchema);

/* ================= UTILS ================= */
function auth(req, res, next) { if (req.session.user) return next(); res.redirect('/login'); }
async function genCode() { let c; do { c = String.fromCharCode(65 + Math.random() * 26 | 0) + (100 + Math.random() * 900 | 0); } while (await Transfert.findOne({ code: c })); return c; }
async function getStock(location, currency) { let s = await Stock.findOne({ location, currency }); if (!s) s = await new Stock({ location, currency, balance: 0 }).save(); return s; }

/* ================= LOGIN ================= */
app.get('/login', (req, res) => res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
.login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
.login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
.login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
.login-container button:hover{background:#e67300;}
</style></head>
<body>
<div class="login-container">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div></body></html>
`));

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let u = await User.findOne({ username });
  if (!u) u = await new User({ username, password: bcrypt.hashSync(password, 10) }).save();
  if (!bcrypt.compareSync(password, u.password)) return res.send('Mot de passe incorrect');
  req.session.user = username;
  res.redirect('/transferts');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

/* ================= FORMULAIRE TRANSFERT ================= */
app.get('/transfert', auth, async (req, res) => {
  let t = null;
  if (req.query.code) t = await Transfert.findOne({ code: req.query.code });
  const code = t ? t.code : await genCode();
  res.send(transfertFormHTML(t, code));
});

app.post('/transfert', auth, async (req, res) => {
  const amount = Number(req.body.amount || 0);
  const fees = Number(req.body.fees || 0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await genCode();
  let existing = await Transfert.findOne({ code });
  if (existing) {
    await Transfert.findByIdAndUpdate(existing._id, { ...req.body, amount, fees, recoveryAmount });
  } else {
    await new Transfert({ ...req.body, amount, fees, recoveryAmount, code, retraitHistory: [] }).save();
  }
  res.redirect('/transferts');
});

/* ================= LISTE DES TRANSFERTS ================= */
app.get('/transferts', auth, async (req, res) => {
  const search = (req.query.search || '').toLowerCase();
  const page = parseInt(req.query.page || 1);
  const limit = 20;

  let list = await Transfert.find().sort({ createdAt: -1 });
  if (search) list = list.filter(t =>
    t.code.toLowerCase().includes(search) ||
    t.senderFirstName.toLowerCase().includes(search) ||
    t.senderLastName.toLowerCase().includes(search) ||
    t.receiverFirstName.toLowerCase().includes(search) ||
    t.receiverLastName.toLowerCase().includes(search)
  );

  const totalPages = Math.ceil(list.length / limit);
  const paginated = list.slice((page - 1) * limit, page * limit);

  const totals = {};
  paginated.forEach(t => {
    if (!totals[t.destinationLocation]) totals[t.destinationLocation] = {};
    if (!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency] = 0;
    totals[t.destinationLocation][t.currency] += t.recoveryAmount;
  });

  res.send(listHTML(paginated, totals, search, page, totalPages));
});

/* ================= ACTIONS ================= */
app.post('/retirer', auth, async (req, res) => {
  const t = await Transfert.findById(req.body.id);
  const s = await getStock(t.destinationLocation, t.currency);
  if (s.balance < t.recoveryAmount) return res.json({ error: 'Stock insuffisant' });
  s.balance -= t.recoveryAmount;
  t.retired = true; t.recoveryMode = req.body.mode;
  t.retraitHistory.push({ date: new Date(), mode: req.body.mode });
  await s.save(); await t.save();
  res.json({ ok: true, rest: s.balance });
});

app.post('/delete', auth, async (req, res) => { await Transfert.findByIdAndDelete(req.body.id); res.json({ ok: true }); });

/* ================= STOCK ================= */
app.get('/stock', auth, async (req, res) => {
  const stock = await Stock.find();
  res.send(stockHTML(stock));
});

app.post('/stock', auth, async (req, res) => {
  const s = await getStock(req.body.location, req.body.currency);
  s.balance += Number(req.body.amount);
  await s.save();
  res.redirect('/stock');
});

/* ================= EXPORTS ================= */
// PDF
app.get('/export/pdf', auth, async (req, res) => {
  const list = await Transfert.find();
  const doc = new PDFDocument();
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);
  list.forEach(t => doc.text(`${t.code} | ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName} | ${t.amount} ${t.currency} | ${t.recoveryAmount} | ${t.destinationLocation} | ${t.retired ? 'Retiré' : 'Non retiré'}`));
  doc.end();
});
// Excel
app.get('/export/excel', auth, async (req, res) => {
  const list = await Transfert.find();
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet('Transferts');
  sh.columns = [
    { header: 'Code', key: 'code' }, { header: 'Type', key: 'userType' }, { header: 'Expéditeur', key: 'sender' },
    { header: 'Origine', key: 'originLocation' }, { header: 'Destinataire', key: 'receiver' },
    { header: 'Destination', key: 'destinationLocation' }, { header: 'Montant', key: 'amount' },
    { header: 'Frais', key: 'fees' }, { header: 'Reçu', key: 'recoveryAmount' },
    { header: 'Devise', key: 'currency' }, { header: 'Statut', key: 'status' }, { header: 'Date', key: 'createdAt' }
  ];
  list.forEach(t => sh.addRow({
    code: t.code,
    userType: t.userType,
    sender: `${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
    originLocation: t.originLocation,
    receiver: `${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
    destinationLocation: t.destinationLocation,
    amount: t.amount,
    fees: t.fees,
    recoveryAmount: t.recoveryAmount,
    currency: t.currency,
    status: t.retired ? 'Retiré' : 'Non retiré',
    createdAt: t.createdAt.toLocaleString()
  }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res); res.end();
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));

/* ================= HTML FUNCTIONS ================= */
function transfertFormHTML(t, code) {
  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;margin:0;padding:10px;background:#f0f4f8;}
  .container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
  h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
  form{display:grid;gap:15px;}
  input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
  button{padding:15px;background:#ff8c42;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;}
  button:hover{background:#e67300;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;}
  </style></head><body>
  <div class="container">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
  <select name="userType">${userTypes.map(u=>`<option ${t&&t.userType===u?'selected':''}>${u}</option>`).join('')}</select>
  <div class="grid">
  <input name="senderFirstName" placeholder="Prénom expéditeur" value="${t?t.senderFirstName:''}" required>
  <input name="senderLastName" placeholder="Nom expéditeur" value="${t?t.senderLastName:''}" required>
  <input name="senderPhone" placeholder="Téléphone expéditeur" value="${t?t.senderPhone:''}" required>
  <select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select>
  </div>
  <div class="grid">
  <input name="receiverFirstName" placeholder="Prénom destinataire" value="${t?t.receiverFirstName:''}" required>
  <input name="receiverLastName" placeholder="Nom destinataire" value="${t?t.receiverLastName:''}" required>
  <input name="receiverPhone" placeholder="Téléphone destinataire" value="${t?t.receiverPhone:''}" required>
  <select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select>
  </div>
  <div class="grid">
  <input type="number" name="amount" placeholder="Montant" value="${t?t.amount:''}" required>
  <input type="number" name="fees" placeholder="Frais" value="${t?t.fees:''}" required>
  <input type="text" name="recoveryAmount" value="${t?t.recoveryAmount:''}" readonly>
  <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
  <input name="code" value="${code}" readonly>
  </div>
  <select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
  <button>${t?'Modifier':'Enregistrer'}</button>
  </form>
  <a href="/transferts">⬅ Retour liste</a>
  <script>
  const amountField=document.querySelector('input[name="amount"]');
  const feesField=document.querySelector('input[name="fees"]');
  const recoveryField=document.querySelector('input[name="recoveryAmount"]');
  function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
  amountField.addEventListener('input',updateRecovery);
  feesField.addEventListener('input',updateRecovery);
  updateRecovery();
  </script>
  </div></body></html>
  `;
}

function listHTML(list, totals, search, page, totalPages) {
  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>
  ${list.map(t=>`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
  <td>${t.code}</td>
  <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
  <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
  <td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td>
  <td>${t.currency}</td>
  <td>${t.retired?'Retiré':'Non retiré'}</td>
  <td>
  <a href="/transfert?code=${t.code}"><button class="modify">✏️</button></a>
  <button class="delete">❌</button>
  <select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select>
  <button class="retirer">💰</button>
  </td></tr>`).join('')}
  </tbody></table>
  <script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('Confirmer?')){const tr=btn.closest('tr');await postData('/delete',{id:tr.dataset.id});tr.remove();}});
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');const mode=tr.querySelector('.retirementMode').value;const r=await postData('/retirer',{id:tr.dataset.id,mode});if(r.ok)tr.querySelector('td:nth-child(8)').innerText='Retiré';else alert(r.error);});
  </script>
  <a href="/transfert">➕ Nouveau transfert</a> | <a href="/stock">💼 Stock</a> | <a href="/logout">🔓 Logout</a>
  </body></html>
  `;
}

function stockHTML(stock) {
  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f4f8;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;}
  th{background:#ff8c42;color:white;}
  input,select{padding:6px;border-radius:6px;border:1px solid #ccc;margin:4px;}
  button{padding:6px 10px;background:#28a745;color:white;border:none;border-radius:6px;cursor:pointer;}
  button:hover{background:#218838;}
  </style></head><body>
  <h2>💼 Stock par ville/devise</h2>
  <table><thead><tr><th>Ville</th><th>Devise</th><th>Solde</th></tr></thead><tbody>
  ${stock.map(s=>`<tr><td>${s.location}</td><td>${s.currency}</td><td>${s.balance}</td></tr>`).join('')}
  </tbody></table>
  <h3>➕ Ajouter dépôt</h3>
  <form method="post">
  <select name="location">${locations.map(l=>`<option>${l}</option>`).join('')}</select>
  <select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
  <input name="amount" placeholder="Montant" type="number" required>
  <button>Déposer</button>
  </form>
  <a href="/transferts">⬅ Retour liste</a>
  </body></html>
  `;
}
