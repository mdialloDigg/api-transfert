/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
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

/* ================= SESSION (MongoStore v4+) ================= */
app.use(session({
  name: 'transfert.sid',
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/test',
    collectionName: 'sessions'
  }),
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 12 // 12h
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
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h2>🔑 Connexion</h2>
<form method="post" action="/login">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<p>Pas de compte ? <a href="/register">Créer un compte</a></p>
</body></html>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await AuthUser.findOne({ username });
  if (!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.send("Mot de passe incorrect");
  req.session.userId = user._id;
  res.redirect('/users/choice');
});

app.get('/register', (req, res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h2>📝 Créer un compte</h2>
<form method="post" action="/register">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Créer</button>
</form>
<p>Déjà un compte ? <a href="/login">Se connecter</a></p>
</body></html>`);
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await new AuthUser({ username, password: hashedPassword }).save();
    res.send("✅ Compte créé ! <a href='/login'>Se connecter</a>");
  } catch (err) {
    res.send("Erreur, nom d'utilisateur déjà pris");
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

/* ================= USERS CHOICE PAGE ================= */
app.get('/users/choice', requireLogin, (req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:40px">
<h2>📋 Gestion des transferts</h2>
<a href="/users/lookup?mode=new"><button>💾 Nouveau transfert</button></a><br><br>
<a href="/users/lookup?mode=edit"><button>✏️ Modifier transfert</button></a><br><br>
<a href="/users/lookup?mode=delete"><button>❌ Supprimer transfert</button></a><br><br>
<a href="/users/all"><button>📋 Liste complète</button></a><br><br>
<a href="/logout">🚪 Déconnexion</a>
</body></html>`);
});

/* ================= USERS LOOKUP ================= */
app.get('/users/lookup', requireLogin, (req,res)=>{
  const mode = req.query.mode || 'edit';
  req.session.choiceMode = mode;
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h3>📞 Numéro expéditeur</h3>
<form method="post" action="/users/lookup">
<input name="phone" required><br><br>
<button>Continuer</button>
</form>
<br><a href="/users/choice">🔙 Retour</a>
</body></html>`);
});

app.post('/users/lookup', requireLogin, async (req,res)=>{
  const u = await User.findOne({ senderPhone:req.body.phone }).sort({ createdAt: -1 });
  req.session.prefill = u || { senderPhone: req.body.phone };

  if(req.session.choiceMode === 'new') req.session.editId = null;
  else if(u) req.session.editId = u._id;
  else if(req.session.choiceMode === 'edit') req.session.editId = null;
  else if(req.session.choiceMode === 'delete'){
    if(u){
      await User.findByIdAndDelete(u._id);
      req.session.prefill = null;
      req.session.editId = null;
      return res.send(`<html><body style="text-align:center;padding-top:50px">
❌ Transfert supprimé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
    } else {
      return res.send(`<html><body style="text-align:center;padding-top:50px">
Aucun transfert trouvé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
    }
  }

  res.redirect('/users/form');
});

/* ================= USERS FORM ================= */
app.get('/users/form', requireLogin, (req,res)=>{
  const u = req.session.prefill || {};
  const isEdit = !!req.session.editId;
  const locations = ['France','Labé','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

  res.send(`<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#dde5f0;margin:0;padding:0}
form{background:#fff;max-width:950px;margin:20px auto;padding:15px;border-radius:8px}
.container{display:flex;flex-wrap:wrap;gap:15px}
.box{flex:1;min-width:250px;padding:10px;border-radius:6px}
.origin{background:#e3f0ff}
.dest{background:#ffe3e3}
input,select,button{width:100%;padding:9px;margin-top:8px;font-size:14px}
button{border:none;color:white;font-size:15px;border-radius:5px;cursor:pointer}
#save{background:#007bff} #cancel{background:#dc3545} #logout{background:#6c757d}
@media(max-width:600px){.container{flex-direction:column}}
</style>
</head>
<body>
<form id="form">
<h3 style="text-align:center">${isEdit?'✏️ Modifier transfert':'💸 Nouveau transfert'}</h3>
<div class="container">
<div class="box origin"><h4>📤 Expéditeur</h4>
<input id="senderFirstName" value="${u.senderFirstName||''}" placeholder="Prénom">
<input id="senderLastName" value="${u.senderLastName||''}" placeholder="Nom">
<input id="senderPhone" value="${u.senderPhone||''}" required placeholder="Téléphone">
<select id="originLocation">${locations.map(v=>`<option ${u.originLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input id="amount" type="number" value="${u.amount||''}" placeholder="Montant">
<input id="fees" type="number" value="${u.fees||''}" placeholder="Frais">
<input id="feePercent" type="number" value="${u.feePercent||''}" placeholder="% Frais">
</div>
<div class="box dest"><h4>📥 Destinataire</h4>
<input id="receiverFirstName" value="${u.receiverFirstName||''}" placeholder="Prénom">
<input id="receiverLastName" value="${u.receiverLastName||''}" placeholder="Nom">
<input id="receiverPhone" value="${u.receiverPhone||''}" placeholder="Téléphone">
<select id="destinationLocation">${locations.map(v=>`<option ${u.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input id="recoveryAmount" type="number" value="${u.recoveryAmount||''}" placeholder="Montant reçu" readonly>
<select id="recoveryMode">
<option ${u.recoveryMode==='Espèces'?'selected':''}>Espèces</option>
<option ${u.recoveryMode==='Orange Money'?'selected':''}>Orange Money</option>
<option ${u.recoveryMode==='Wave'?'selected':''}>Wave</option>
<option ${u.recoveryMode==='Produit'?'selected':''}>Produit</option>
<option ${u.recoveryMode==='Service'?'selected':''}>Service</option>
</select>
</div>
</div>
<button id="save">${isEdit?'💾 Mettre à jour':'💾 Enregistrer'}</button>
${isEdit?'<button type="button" id="cancel" onclick="cancelTransfer()">❌ Supprimer</button>':''}
<button type="button" id="logout" onclick="location.href='/logout'">🚪 Déconnexion</button>
<p id="message"></p>
</form>
<script>
const amount = document.getElementById('amount');
const fees = document.getElementById('fees');
const recoveryAmount = document.getElementById('recoveryAmount');
function updateRecoveryAmount(){recoveryAmount.value = (+amount.value||0) - (+fees.value||0);}
amount.addEventListener('input', updateRecoveryAmount);
fees.addEventListener('input', updateRecoveryAmount);

form.onsubmit=async e=>{
  e.preventDefault();
  const url='${isEdit?'/users/update':'/users'}';
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({
    senderFirstName:senderFirstName.value,
    senderLastName:senderLastName.value,
    senderPhone:senderPhone.value,
    originLocation:originLocation.value,
    amount:+amount.value,
    fees:+fees.value,
    feePercent:+feePercent.value,
    receiverFirstName:receiverFirstName.value,
    receiverLastName:receiverLastName.value,
    receiverPhone:receiverPhone.value,
    destinationLocation:destinationLocation.value,
    recoveryAmount:+recoveryAmount.value,
    recoveryMode:recoveryMode.value
  })});
  const d=await r.json();
  message.innerText=d.message;
};

function cancelTransfer(){
  if(!confirm('Voulez-vous supprimer ce transfert ?'))return;
  fetch('/users/delete',{method:'POST'}).then(()=>location.href='/users/choice');
}
</script>
</body></html>`);
});

/* ================= CRUD ================= */
app.post('/users', requireLogin, async (req,res)=>{
  const code=Math.floor(100000+Math.random()*900000).toString();
  await new User({...req.body, code,status:'actif'}).save();
  res.json({message:'✅ Transfert enregistré | Code '+code});
});

app.post('/users/update', requireLogin, async (req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndUpdate(req.session.editId, req.body);
  req.session.editId=null;
  res.json({message:'✏️ Transfert mis à jour'});
});

app.post('/users/delete', requireLogin, async (req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndDelete(req.session.editId);
  req.session.editId=null;
  res.json({message:'❌ Transfert supprimé'});
});

/* ================= LISTE COMPLETE AVEC RETRAIT ================= */
app.get('/users/all', requireLogin, async (req,res)=>{
  const users = await User.find().sort({destinationLocation:1, createdAt:1});

  let html = `<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff;margin-bottom:40px}
th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
th{background:#007bff;color:#fff}
tr.retired{background-color:orange;color:#000;}
button.retirer{padding:5px 10px;border:none;border-radius:4px;background:#28a745;color:#fff;cursor:pointer;}
select{padding:4px}
</style></head><body>
<h2 style="text-align:center">📋 Liste des transferts</h2>
<button onclick="window.location='/users/export/pdf'">📄 Export PDF</button>
<button onclick="fetch('/logout').then(()=>location.href='/login')">🚪 Déconnexion</button>
<table>
<tr>
<th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th>
<th>Destinataire</th><th>Tél Dest.</th><th>Destination</th>
<th>Montant reçu</th><th>Code</th><th>Date</th><th>Action</th>
</tr>`;

  users.forEach(u=>{
    html += `<tr class="${u.retired?'retired':''}">
<td>${u.senderFirstName||''} ${u.senderLastName||''}</td>
<td>${u.senderPhone||''}</td>
<td>${u.originLocation||''}</td>
<td>${u.amount||0}</td>
<td>${u.fees||0}</td>
<td>${u.receiverFirstName||''} ${u.receiverLastName||''}</td>
<td>${u.receiverPhone||''}</td>
<td>${u.destinationLocation||''}</td>
<td>${u.recoveryAmount||0}</td>
<td>${u.code||''}</td>
<td>${u.createdAt?new Date(u.createdAt).toLocaleString():''}</td>
<td>${u.retired?'Montant retiré':`<select onchange="retirer('${u._id}',this)">
<option value="">💰 Retirer...</option>
<option>Espèces</option>
<option>Orange Money</option>
<option>Produit</option>
<option>Service</option>
</select>`}</td>
</tr>`;
  });

  html += `</table>
<script>
async function retirer(id,sel){
  if(!sel.value) return;
  const res = await fetch('/users/retirer',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,mode:sel.value})
  });
  const data = await res.json();
  alert(data.message);
  sel.closest('tr').classList.add('retired');
  sel.outerHTML='Montant retiré';
}
</script>
</body></html>`;

  res.send(html);
});

/* ================= EXPORT PDF ================= */
app.get('/users/export/pdf', requireLogin, async (req,res)=>{
  const users = await User.find().sort({destinationLocation:1, createdAt:1});
  const doc = new PDFDocument({margin:30, size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment;filename=transferts.pdf');
  doc.pipe(res);

  doc.fontSize(18).text('Liste des transferts', {align:'center'});
  doc.moveDown();

  users.forEach(u=>{
    doc.fontSize(12).text(`Expéditeur: ${u.senderFirstName} ${u.senderLastName} | Tél: ${u.senderPhone} | Origine: ${u.originLocation} | Montant: ${u.amount} | Frais: ${u.fees}`);
    doc.text(`Destinataire: ${u.receiverFirstName} ${u.receiverLastName} | Tél: ${u.receiverPhone} | Destination: ${u.destinationLocation}`);
    doc.text(`Montant reçu: ${u.recoveryAmount} | Mode: ${u.recoveryMode} | Code: ${u.code}`);
    doc.text(`Date: ${u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}`);
    doc.moveDown();
  });

  doc.end();
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur prêt sur le port ${PORT}`));
