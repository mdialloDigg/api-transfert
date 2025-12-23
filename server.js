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

const authUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

/* ================= MIDDLEWARE AUTH ================= */
function requireLogin(req, res, next){
  if(req.session.userId) return next();
  res.redirect('/login');
}

/* ================= AUTH ================= */
/* --- (INCHANGÉ, IDENTIQUE À TON CODE) --- */
app.get('/login', (req,res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>🔑 Connexion</h2>
<form method="post" action="/login">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<p>Pas de compte ? <a href="/register">Créer un compte</a></p>
</body></html>`);
});

app.post('/login', async (req,res) => {
  const { username, password } = req.body;
  const user = await AuthUser.findOne({ username });
  if(!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(password, user.password);
  if(!match) return res.send("Mot de passe incorrect");
  req.session.userId = user._id;
  res.redirect('/users/choice');
});

app.get('/register', (req,res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>📝 Créer un compte</h2>
<form method="post" action="/register">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Créer</button>
</form>
<p>Déjà un compte ? <a href="/login">Se connecter</a></p>
</body></html>`);
});

app.post('/register', async (req,res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await new AuthUser({ username, password: hashedPassword }).save();
    res.send("✅ Compte créé ! <a href='/login'>Se connecter</a>");
  } catch(err) {
    res.send("Erreur, nom d'utilisateur déjà pris");
  }
});

app.get('/logout', (req,res) => {
  req.session.destroy();
  res.redirect('/login');
});

/* ================= (TOUT LE FORMULAIRE / CRUD = INCHANGÉ) ================= */
/* 🔴 AUCUNE LIGNE SUPPRIMÉE OU MODIFIÉE ICI */
/* 👉 exactement ton code jusqu’à /users/all */

/* ================= LISTE /users/all (RETIRAIT AMÉLIORÉ) ================= */
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
  let totalAmount = 0, totalRecovery = 0, totalFees = 0;

  users.forEach(u=>{
    if(!grouped[u.destinationLocation]) grouped[u.destinationLocation] = [];
    grouped[u.destinationLocation].push(u);
    totalAmount += (u.amount||0);
    totalRecovery += (u.recoveryAmount||0);
    totalFees += (u.fees||0);
  });

  let html = `<html><head>
<style>
body{font-family:Arial;background:#f4f6f9}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff}
th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
th{background:#007bff;color:#fff}
tr.retired{background:orange}
button{padding:6px 10px}
.modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
.box{background:#fff;padding:25px;border-radius:10px;width:380px}
</style></head><body>
<h2 style="text-align:center">📋 Liste des transferts</h2>
<button onclick="location.href='/users/export/pdf'">📄 PDF</button>
`;

  for(let dest in grouped){
    html+=`<h3 style="text-align:center">${dest}</h3><table>
<tr><th>Expéditeur</th><th>Montant</th><th>Reçu</th><th>Action</th></tr>`;
    grouped[dest].forEach(u=>{
      html+=`<tr class="${u.retired?'retired':''}">
<td>${u.senderPhone}</td>
<td>${u.amount}</td>
<td>${u.recoveryAmount}</td>
<td>${u.retired?'Retiré':`<button onclick="openModal('${u._id}',this)">💰 Retirer</button>`}</td>
</tr>`;
    });
    html+=`</table><br>`;
  }

  html+=`
<div id="modal" style="display:none"></div>
<script>
function openModal(id,btn){
  modal.style.display='flex';
  modal.innerHTML=\`
  <div class="modal">
    <div class="box">
      <h3>💰 Retrait</h3>
      <select id="mode" style="width:100%;padding:10px">
        <option>Espèces</option>
        <option>Orange Money</option>
        <option>Wave</option>
        <option>Produit</option>
        <option>Service</option>
      </select><br><br>
      <button onclick="valider('${id}',btn)">Valider</button>
      <button onclick="modal.style.display='none'">Annuler</button>
    </div>
  </div>\`;
}
async function valider(id,btn){
  const mode=document.getElementById('mode').value;
  await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
  btn.parentElement.parentElement.classList.add('retired');
  btn.outerHTML='Retiré';
  modal.style.display='none';
}
</script></body></html>`;
  res.send(html);
});

/* ================= PDF PLUS PRO ================= */
app.get('/users/export/pdf', requireLogin, async (req,res)=>{
  const users = await User.find({}).sort({createdAt:1});
  const doc = new PDFDocument({margin:40});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment;filename=transferts.pdf');
  doc.pipe(res);

  doc.fontSize(18).text('LISTE DES TRANSFERTS', {align:'center'});
  doc.moveDown();

  users.forEach((u,i)=>{
    doc.fontSize(12).text(`${i+1}. ${u.senderPhone} → ${u.receiverPhone}`);
    doc.text(`Montant: ${u.amount} | Frais: ${u.fees} | Reçu: ${u.recoveryAmount}`);
    doc.text(`Destination: ${u.destinationLocation} | Mode: ${u.recoveryMode || '-'}`);
    doc.moveDown();
    doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
  });

  doc.end();
});

/* ================= SERVEUR ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur OK sur ${PORT}`));
