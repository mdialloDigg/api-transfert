/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLÈTE (PRODUCTION)
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.set('bufferCommands', false);

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert', {
  serverSelectionTimeoutMS: 5000
})
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{
  console.error('❌ MongoDB erreur:', err.message);
  process.exit(1);
});

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: String,

  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,

  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,

  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: String,

  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },

  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const Transfert = mongoose.model('Transfert', transfertSchema);

const Auth = mongoose.model('Auth', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}));

/* ================= UTILS ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = String.fromCharCode(65 + Math.random()*26|0) + (100 + Math.random()*900|0);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><style>
body{font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.2)}
input,button{padding:12px;margin:6px;width:240px}
button{background:#007bff;color:white;border:none;border-radius:6px}
</style>
<form method="post">
<h2>Connexion</h2>
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
</html>`);
});

app.post('/login', async(req,res)=>{
  let user = await Auth.findOne({ username:req.body.username });
  if(!user){
    user = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,user.password))
    return res.send('Mot de passe incorrect');

  req.session.user = user.username;
  res.redirect('/menu');
});

/* ================= MENU ================= */
app.get('/menu', requireLogin,(req,res)=>{
res.send(`
<html><style>
body{text-align:center;background:#eef2f7;font-family:Arial;padding-top:50px}
button{width:280px;padding:15px;margin:12px;border-radius:8px;border:none;color:white;font-size:16px}
.send{background:#007bff}.list{background:#28a745}.logout{background:#dc3545}
</style>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/form"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Dashboard</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</html>`);
});

/* ================= FORMULAIRE ================= */
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t ? t.code : await generateUniqueCode();

res.send(`
<html><style>
body{background:#f0f4f8;font-family:Arial}
.container{max-width:860px;margin:30px auto;background:#fff;padding:25px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,.15)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px}
input,select{padding:10px;border-radius:6px;border:1px solid #ccc}
input[readonly]{background:#e9ecef}
button{width:100%;padding:14px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px}
</style>

<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>

<form method="post">
<select name="userType">
${['Client','Distributeur','Administrateur','Agence de transfert']
.map(v=>`<option ${t?.userType===v?'selected':''}>${v}</option>`).join('')}
</select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" placeholder="Prénom" value="${t?.senderFirstName||''}" required>
<input name="senderLastName" placeholder="Nom" value="${t?.senderLastName||''}" required>
<input name="senderPhone" placeholder="Téléphone" value="${t?.senderPhone||''}" required>
<input name="originLocation" placeholder="Origine" value="${t?.originLocation||''}" required>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" placeholder="Prénom" value="${t?.receiverFirstName||''}" required>
<input name="receiverLastName" placeholder="Nom" value="${t?.receiverLastName||''}" required>
<input name="receiverPhone" placeholder="Téléphone" value="${t?.receiverPhone||''}" required>
<input name="destinationLocation" placeholder="Destination" value="${t?.destinationLocation||''}" required>
</div>

<h3>Montants</h3>
<div class="grid">
<input type="number" name="amount" id="amount" placeholder="Montant" value="${t?.amount||''}" required>
<input type="number" name="fees" id="fees" placeholder="Frais" value="${t?.fees||''}" required>
<input readonly id="recovery">
<select name="currency">
${['GNF','EUR','USD','XOF'].map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`).join('')}
</select>
</div>

<input type="hidden" name="code" value="${code}">
<button>Enregistrer</button>
</form>
</div>

<script>
const a=document.getElementById('amount');
const f=document.getElementById('fees');
const r=document.getElementById('recovery');
function calc(){r.value=(a.value||0)-(f.value||0);}
a.oninput=f.oninput=calc; calc();
</script>
</html>`);
});

/* ================= ENREGISTREMENT ================= */
app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount);
  const fees = Number(req.body.fees);
  const recoveryAmount = amount - fees;

  const data = {...req.body, amount, fees, recoveryAmount};

  const exist = await Transfert.findOne({code:req.body.code});
  if(exist) await Transfert.updateOne({_id:exist._id},data);
  else await new Transfert(data).save();

  res.redirect('/transferts/list');
});

/* ================= LISTE + DASHBOARD ================= */
app.get('/transferts/list', requireLogin, async(req,res)=>{
  let list = await Transfert.find().sort({destinationLocation:1, createdAt:-1});

  if(req.query.search){
    const s=req.query.search.toLowerCase();
    list=list.filter(t=>
      t.senderPhone.includes(s)||
      t.receiverPhone.includes(s)||
      t.code.toLowerCase().includes(s)||
      t.receiverLastName.toLowerCase().includes(s)
    );
  }

  if(req.query.destination)
    list=list.filter(t=>t.destinationLocation===req.query.destination);

  if(req.query.status==='retired') list=list.filter(t=>t.retired);
  if(req.query.status==='not') list=list.filter(t=>!t.retired);

  const destinations=[...new Set((await Transfert.find()).map(t=>t.destinationLocation))];

  const grouped={};
  list.forEach(t=>{
    if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[];
    grouped[t.destinationLocation].push(t);
  });

res.send(`
<!-- DASHBOARD HTML + GRAPHIQUES -->
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
.card{background:#fff;border-radius:12px;padding:15px;margin:10px;box-shadow:0 4px 12px rgba(0,0,0,.1)}
.actions button{margin:4px;padding:6px 10px;border-radius:6px;border:none;color:white}
.modify{background:#28a745}.delete{background:#dc3545}.print{background:#17a2b8}
</style>
</head>
<body>

<h1>📊 Dashboard Transferts</h1>

<form>
<input name="search" placeholder="Téléphone / Code / Nom">
<select name="destination"><option value="">Destination</option>
${destinations.map(d=>`<option>${d}</option>`).join('')}</select>
<select name="status">
<option value="">Statut</option>
<option value="retired">Retiré</option>
<option value="not">Non retiré</option>
</select>
<button>🔍 Rechercher</button>
</form>

<canvas id="pie" height="120"></canvas>

${Object.keys(grouped).map(dest=>`
<h2>${dest}</h2>
${grouped[dest].map(t=>`
<div class="card">
<b>Code:</b> ${t.code}<br>
<b>Expéditeur:</b> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})<br>
<b>Destinataire:</b> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})<br>
<b>Montant:</b> ${t.amount} ${t.currency} | Reçu ${t.recoveryAmount}<br>
<b>Statut:</b> ${t.retired?'Retiré':'Non retiré'}<br>

<div class="actions">
<a href="/transferts/form?code=${t.code}"><button class="modify">✏️</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')">
<button class="delete">❌</button></a>
<a href="/transferts/print/${t._id}" target="_blank">
<button class="print">🖨️</button></a>
</div>
</div>
`).join('')}
`).join('')}

<script>
new Chart(document.getElementById('pie'),{
 type:'pie',
 data:{labels:['Retiré','Non retiré'],
 datasets:[{data:[
 ${list.filter(t=>t.retired).length},
 ${list.filter(t=>!t.retired).length}
 ]}]},
 options:{responsive:true}
});
</script>

</body></html>`);
});

/* ================= SUPPRIMER ================= */
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

/* ================= IMPRIMER ================= */
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
res.send(`
<body onload="print()">
<h3>💰 TRANSFERT</h3>
Code: ${t.code}<br>
Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})<br>
Origine: ${t.originLocation}<br>
Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})<br>
Destination: ${t.destinationLocation}<br>
Montant: ${t.amount} ${t.currency}<br>
Frais: ${t.fees}<br>
À recevoir: ${t.recoveryAmount}<br>
Statut: ${t.retired?'Retiré':'Non retiré'}<br>
Date: ${new Date(t.createdAt).toLocaleString()}
</body>`);
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Serveur prêt sur',PORT));
