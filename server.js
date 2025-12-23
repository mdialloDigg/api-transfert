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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test')
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(console.error);

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

/* ================= LISTE /users/all ================= */
app.get('/users/all', requireLogin, async (req,res)=>{
  if(!req.session.listAccess){
    return res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>🔒 Accès liste</h2>
<form method="post" action="/auth/list">
<input type="password" name="code" placeholder="Code 147" required><br><br>
<button>Valider</button>
</form></body></html>`);
  }

  const users = await User.find({}).sort({destinationLocation:1, createdAt:1});
  const grouped = {};

  users.forEach(u=>{
    if(!grouped[u.destinationLocation]) grouped[u.destinationLocation] = [];
    grouped[u.destinationLocation].push(u);
  });

  let html = `<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff;margin-bottom:40px}
th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
th{background:#007bff;color:#fff}
tr.retired{background-color:orange}
select{padding:5px}
</style></head><body>
<h2 style="text-align:center">📋 Liste des transferts</h2>
`;

for(let dest in grouped){
  html += `<h3 style="text-align:center">${dest}</h3><table>
<tr>
<th>Expéditeur</th><th>Montant</th><th>Code</th><th>Action</th>
</tr>`;

  grouped[dest].forEach(u=>{
    html += `<tr class="${u.retired?'retired':''}">
<td>${u.senderFirstName||''}</td>
<td>${u.amount||0}</td>
<td>${u.code||''}</td>
<td>
${u.retired ? 'Montant retiré' : `
<select onchange="retirer('${u._id}', this)">
<option value="">💰 Retirer...</option>
<option value="Espèces">Espèces</option>
<option value="Orange Money">Orange Money</option>
<option value="Produit">Produit</option>
<option value="Service">Service</option>
</select>`}
</td>
</tr>`;
  });

  html += `</table>`;
}

html += `
<script>
async function retirer(id, select){
  const mode = select.value;
  if(!mode) return;
  const row = select.closest('tr');

  const res = await fetch('/users/retirer',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,mode})
  });

  const data = await res.json();
  alert(data.message);
  row.classList.add('retired');
  select.outerHTML = 'Montant retiré';
}
</script>
</body></html>`;

res.send(html);
});
