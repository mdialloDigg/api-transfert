/******************************************************************
 * APP STOCK + TRANSFERT
 * FINAL – UN SEUL FICHIER – NODE 20 – RENDER SAFE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 10000;

/* ===================== MIDDLEWARE ===================== */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'render-secret',
  resave: false,
  saveUninitialized: false
}));

/* ===================== MONGODB SAFE ===================== */
if (!process.env.MONGO_URI) {
  console.error('❌ ERREUR : MONGO_URI non défini dans Render');
  console.error('👉 Ajoute MONGO_URI dans Render > Environment');
  process.exit(1);
}

mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => {
  console.error('❌ MongoDB ERROR :', err.message);
  process.exit(1);
});

/* ===================== MODELS ===================== */
const Auth = mongoose.model('Auth', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}));

const Stock = mongoose.model('Stock', new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String,
  createdAt: { type: Date, default: Date.now }
}));

const Transfer = mongoose.model('Transfer', new mongoose.Schema({
  sender: String,
  receiver: String,
  amount: Number,
  currency: String,
  code: String,
  createdAt: { type: Date, default: Date.now }
}));

/* ===================== AUTH ===================== */
const auth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

app.get('/login', (req, res) => {
  res.send(`
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required><br>
      <input name="password" placeholder="Mot de passe" required><br>
      <button>Connexion</button>
    </form>
  `);
});

app.post('/login', async (req, res) => {
  try {
    let user = await Auth.findOne({ username: req.body.username });
    if (!user) {
      user = await Auth.create(req.body);
    }
    req.session.user = user;
    res.redirect('/');
  } catch (err) {
    res.send('Erreur base de données');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ===================== DASHBOARD ===================== */
app.get('/', auth, async (req, res) => {
  const stocks = await Stock.find().lean();
  const transfers = await Transfer.find().lean();

  const stockRows = stocks.map(s => `
    <tr data-id="${s._id}">
      <td><input value="${s.sender}"></td>
      <td><input value="${s.destination}"></td>
      <td><input value="${s.amount}"></td>
      <td><input value="${s.currency}"></td>
      <td>
        <button class="save">💾</button>
        <button class="del">❌</button>
      </td>
    </tr>
  `).join('');

  const transferRows = transfers.map(t => `
    <tr>
      <td>${t.sender}</td>
      <td>${t.receiver}</td>
      <td>${t.amount}</td>
      <td>${t.currency}</td>
      <td>${t.code}</td>
    </tr>
  `).join('');

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
table { width:100%; border-collapse:collapse }
td, th { border:1px solid #ccc; padding:4px }
input { width:100% }
button { margin:2px }
</style>
</head>
<body>

<h2>Stocks</h2>
<table>
<tr><th>Sender</th><th>Destination</th><th>Amount</th><th>Currency</th><th>Actions</th></tr>
${stockRows}
</table>

<input id="s"><input id="d"><input id="a"><input id="c">
<button onclick="addStock()">Ajouter Stock</button>

<h2>Transferts</h2>
<table>
<tr><th>Sender</th><th>Receiver</th><th>Amount</th><th>Currency</th><th>Code</th></tr>
${transferRows}
</table>

<button onclick="addTransfer()">Ajouter Transfert</button>
<br><br>
<a href="/export/pdf">📄 PDF</a> | <a href="/export/excel">📊 Excel</a> | <a href="/logout">🚪 Déconnexion</a>

<script>
async function addStock() {
  await fetch('/stock', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      sender:s.value,
      destination:d.value,
      amount:+a.value,
      currency:c.value
    })
  });
  location.reload();
}

document.querySelectorAll('.save').forEach(btn=>{
  btn.onclick = async () => {
    const tr = btn.closest('tr');
    await fetch('/stock/' + tr.dataset.id, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sender: tr.children[0].querySelector('input').value,
        destination: tr.children[1].querySelector('input').value,
        amount: +tr.children[2].querySelector('input').value,
        currency: tr.children[3].querySelector('input').value
      })
    });
    alert('Modifié');
  };
});

document.querySelectorAll('.del').forEach(btn=>{
  btn.onclick = async () => {
    const tr = btn.closest('tr');
    await fetch('/stock/' + tr.dataset.id, { method:'DELETE' });
    tr.remove();
  };
});

async function addTransfer() {
  await fetch('/transfer', { method:'POST' });
  location.reload();
}
</script>
</body>
</html>
`);
});

/* ===================== API ===================== */
app.post('/stock', auth, async (req, res) => {
  await Stock.create(req.body);
  res.json({ ok: true });
});

app.put('/stock/:id', auth, async (req, res) => {
  await Stock.findByIdAndUpdate(req.params.id, req.body);
  res.json({ ok: true });
});

app.delete('/stock/:id', auth, async (req, res) => {
  await Stock.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

app.post('/transfer', auth, async (req, res) => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  await Transfer.create({
    sender: 'Client',
    receiver: 'Agence',
    amount: 100,
    currency: 'GNF',
    code
  });
  res.json({ ok: true });
});

/* ===================== EXPORT PDF ===================== */
app.get('/export/pdf', auth, async (req, res) => {
  const doc = new PDFDocument();
  res.setHeader('Content-Disposition', 'attachment; filename=transferts.pdf');
  doc.pipe(res);
  const data = await Transfer.find();
  data.forEach(t => {
    doc.text(`${t.sender} -> ${t.receiver} : ${t.amount} ${t.currency} (${t.code})`);
  });
  doc.end();
});

/* ===================== EXPORT EXCEL ===================== */
app.get('/export/excel', auth, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transferts');
  ws.addRow(['Sender','Receiver','Amount','Currency','Code']);
  (await Transfer.find()).forEach(t =>
    ws.addRow([t.sender, t.receiver, t.amount, t.currency, t.code])
  );
  res.setHeader('Content-Disposition', 'attachment; filename=transferts.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

/* ===================== SERVER ===================== */
app.listen(PORT, () => {
  console.log('🚀 Serveur démarré sur le port ' + PORT);
});
