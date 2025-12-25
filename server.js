/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLÈTE
 ******************************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect('mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType:String,
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  recoveryMode:String,
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const Auth = mongoose.model('Auth',new mongoose.Schema({
  username:String,password:String
}));

// ================= UTILS =================
async function generateUniqueCode(){
  let c,e=true;
  while(e){
    c=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    e=await Transfert.findOne({code:c});
  }
  return c;
}
const requireLogin=(req,res,next)=>req.session.user?next():res.redirect('/login');

// ================= LOGIN =================
app.get('/login',(req,res)=>res.send(`
<html><style>
body{text-align:center;background:#f0f4f8;font-family:Arial;padding-top:80px}
form{background:#fff;padding:30px;border-radius:12px;display:inline-block}
input,button{padding:12px;margin:8px;width:240px}
button{background:#007bff;color:white;border:none}
</style>
<h2>Connexion</h2>
<form method="post">
<input name="username" required placeholder="Utilisateur">
<input type="password" name="password" required placeholder="Mot de passe">
<button>Connexion</button>
</form></html>`));

app.post('/login',async(req,res)=>{
  let u=await Auth.findOne({username:req.body.username});
  if(!u) u=await new Auth({
    username:req.body.username,
    password:bcrypt.hashSync(req.body.password,10)
  }).save();
  if(!bcrypt.compareSync(req.body.password,u.password)) return res.send('Mot de passe incorrect');
  req.session.user=u.username;
  res.redirect('/menu');
});

// ================= MENU =================
app.get('/menu',requireLogin,(req,res)=>res.send(`
<html><style>
body{text-align:center;background:#eef2f7;font-family:Arial}
button{padding:15px;margin:10px;width:260px}
</style>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/form"><button>➕ Nouveau transfert</button></a><br>
<a href="/transferts/list"><button>📊 Dashboard</button></a><br>
<a href="/logout"><button>🚪 Déconnexion</button></a>
</html>`));

// ================= DATA =================
const locations=['France','Belgique','Conakry','Suisse','USA','Allemagne'];
const currencies=['GNF','EUR','USD','XOF'];

// ================= FORM =================
app.get('/transferts/form',requireLogin,async(req,res)=>{
const t=req.query.code?await Transfert.findOne({code:req.query.code}):null;
const code=t?t.code:await generateUniqueCode();
res.send(`
<html><style>
body{background:#f4f6f9;font-family:Arial}
.container{max-width:750px;margin:25px auto;background:white;padding:20px;border-radius:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px}
input,select{padding:10px;font-size:13px;width:100%}
button{padding:14px;width:100%;background:#28a745;color:white;border:none}
</style>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<select name="userType"><option>Client</option><option>Distributeur</option><option>Administrateur</option><option>Agence</option></select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" value="${t?.senderFirstName||''}" placeholder="Prénom" required>
<input name="senderLastName" value="${t?.senderLastName||''}" placeholder="Nom" required>
<input name="senderPhone" value="${t?.senderPhone||''}" placeholder="Téléphone" required>
<select name="originLocation">${locations.map(l=>`<option ${t?.originLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" value="${t?.receiverFirstName||''}" placeholder="Prénom" required>
<input name="receiverLastName" value="${t?.receiverLastName||''}" placeholder="Nom" required>
<input name="receiverPhone" value="${t?.receiverPhone||''}" placeholder="Téléphone" required>
<select name="destinationLocation">${locations.map(l=>`<option ${t?.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Montants</h3>
<div class="grid">
<input type="number" id="amount" name="amount" value="${t?.amount||''}">
<input type="number" id="fees" name="fees" value="${t?.fees||''}">
<input readonly id="recovery">
<select name="currency">${currencies.map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`).join('')}</select>
<input name="code" readonly value="${code}">
</div>

<button>Enregistrer</button>
</form></div>
<script>
function calc(){recovery.value=(amount.value-fees.value)||0}
amount.oninput=fees.oninput=calc;calc();
</script></html>`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
  const a=+req.body.amount||0,f=+req.body.fees||0;
  const r=a-f;
  let t=await Transfert.findOne({code:req.body.code});
  if(t) await Transfert.findByIdAndUpdate(t._id,{...req.body,amount:a,fees:f,recoveryAmount:r});
  else await new Transfert({...req.body,amount:a,fees:f,recoveryAmount:r,retraitHistory:[]}).save();
  res.redirect('/transferts/list');
});

// ================= RETRAIT =================
app.post('/transferts/retirer',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,recoveryMode:req.body.mode,
    $push:{retraitHistory:{date:new Date(),mode:req.body.mode}}
  });
  res.redirect('/transferts/list');
});

// ================= DELETE =================
app.get('/transferts/delete/:id',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= DASHBOARD =================
app.get('/transferts/list',requireLogin,async(req,res)=>{
const all=await Transfert.find().sort({destinationLocation:1});
let f=all;
if(req.query.searchPhone)f=f.filter(t=>t.senderPhone.includes(req.query.searchPhone)||t.receiverPhone.includes(req.query.searchPhone));
if(req.query.searchCode)f=f.filter(t=>t.code.includes(req.query.searchCode));
if(req.query.searchName)f=f.filter(t=>(t.receiverFirstName+t.receiverLastName).toLowerCase().includes(req.query.searchName.toLowerCase()));
if(req.query.destination && req.query.destination!=='all')f=f.filter(t=>t.destinationLocation===req.query.destination);

const dests=[...new Set(all.map(t=>t.destinationLocation))];
const stats=dests.map(d=>all.filter(t=>t.destinationLocation===d).reduce((s,t)=>s+t.amount,0));
const retired=f.filter(t=>t.retired).length;
const notRetired=f.length-retired;

res.send(`
<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{background:#f4f6f9;font-family:Arial;padding:20px}
.search{display:flex;gap:10px;flex-wrap:wrap}
.card{background:white;padding:15px;border-radius:12px;margin:10px 0}
.status{padding:4px 8px;color:white;border-radius:6px}
.retiré{background:#dc3545}.non{background:#28a745}
canvas{max-width:350px;margin:auto}
</style>
</head>
<h2>📊 Dashboard Transferts</h2>

<form class="search">
<input name="searchPhone" placeholder="Téléphone">
<input name="searchCode" placeholder="Code">
<input name="searchName" placeholder="Nom">
<select name="destination"><option value="all">Toutes destinations</option>${dests.map(d=>`<option>${d}</option>`).join('')}</select>
<button>🔍</button>
</form>

<h3>Montants par destination</h3>
<canvas id="bar"></canvas>

<h3>Retirés / Non retirés</h3>
<canvas id="pie" height="70"></canvas>

${f.map(t=>`
<div class="card">
<b>Code:</b> ${t.code} |
<b>${t.receiverFirstName} ${t.receiverLastName}</b> |
${t.destinationLocation} |
<span class="status ${t.retired?'retiré':'non'}">${t.retired?'Retiré':'Non retiré'}</span>
<br>
Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount}
<br><br>
<a href="/transferts/form?code=${t.code}">✏️ Modifier</a> |
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')">❌ Supprimer</a> |
<a href="/transferts/print/${t._id}" target="_blank">🖨️ Imprimer</a>
${!t.retired?`
<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option></select>
<button>Retirer</button>
</form>`:''}
</div>`).join('')}

<script>
new Chart(bar,{type:'bar',data:{labels:${JSON.stringify(dests)},datasets:[{data:${JSON.stringify(stats)},backgroundColor:'#007bff'}]},options:{plugins:{legend:{display:false}}}});
new Chart(pie,{type:'pie',data:{labels:['Retirés','Non retirés'],datasets:[{data:[${retired},${notRetired}],backgroundColor:['#dc3545','#28a745']}]},options:{plugins:{legend:{position:'bottom'}}}});
</script>
</html>`);
});

// ================= PRINT =================
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`<html><body onload="print()">
<h3>💰 Transfert</h3>
Code:${t.code}<br>Montant:${t.amount} ${t.currency}<br>Reçu:${t.recoveryAmount}
</body></html>`);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

// ================= SERVER =================
app.listen(3000,()=>console.log('🚀 Serveur prêt : http://localhost:3000'));
