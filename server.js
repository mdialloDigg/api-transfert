/******************************************************************
 * APP TRANSFERT – DASHBOARD MODERNE FINAL (VERSION OPTIMISÉE)
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
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
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
  currency: { type:String, default:'GNF' },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type:Boolean, default:false },
  code: { type:String, unique:true },
  createdAt: { type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0) + (100+Math.random()*900|0);
    exists = await Transfert.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`<html><style>
body{text-align:center;background:#f0f4f8;padding-top:80px;font-family:Arial}
form{background:#fff;padding:30px;border-radius:12px;display:inline-block}
input,button{padding:12px;margin:8px;width:250px}
button{background:#007bff;color:white;border:none}
</style>
<h2>Connexion</h2>
<form method="post">
<input name="username" required placeholder="Utilisateur"><br>
<input type="password" name="password" required placeholder="Mot de passe"><br>
<button>Connexion</button>
</form></html>`);
});

app.post('/login', async(req,res)=>{
  let u = await Auth.findOne({username:req.body.username});
  if(!u){
    u = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,u.password))
    return res.send('Mot de passe incorrect');
  req.session.user = u.username;
  res.redirect('/menu');
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
res.send(`<html><style>
body{text-align:center;background:#eef2f7;font-family:Arial}
button{padding:15px;margin:10px;width:260px}
</style>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/form"><button>➕ Nouveau transfert</button></a><br>
<a href="/transferts/list"><button>📊 Dashboard</button></a><br>
<a href="/logout"><button>🚪 Déconnexion</button></a>
</html>`);
});

// ================= DATA =================
const locations=['France','Belgique','Conakry','Suisse','USA','Allemagne'];
const currencies=['GNF','EUR','USD','XOF'];

// ================= FORM =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
const code = t?t.code:await generateUniqueCode();
res.send(`<html><style>
body{background:#f4f6f9;font-family:Arial}
.container{max-width:750px;margin:25px auto;background:white;padding:20px;border-radius:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px}
input,select{padding:10px;font-size:13px;width:100%}
button{padding:14px;width:100%;background:#28a745;color:white;border:none}
</style>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<select name="userType">
<option>Client</option><option>Distributeur</option>
<option>Administrateur</option><option>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" value="${t?t.senderFirstName:''}" placeholder="Prénom" required>
<input name="senderLastName" value="${t?t.senderLastName:''}" placeholder="Nom" required>
<input name="senderPhone" value="${t?t.senderPhone:''}" placeholder="Téléphone" required>
<select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" value="${t?t.receiverFirstName:''}" placeholder="Prénom" required>
<input name="receiverLastName" value="${t?t.receiverLastName:''}" placeholder="Nom" required>
<input name="receiverPhone" value="${t?t.receiverPhone:''}" placeholder="Téléphone" required>
<select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Montants</h3>
<div class="grid">
<input type="number" name="amount" id="amount" value="${t?t.amount:''}" placeholder="Montant">
<input type="number" name="fees" id="fees" value="${t?t.fees:''}" placeholder="Frais">
<input readonly id="recovery">
<select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
<input name="code" readonly value="${code}">
</div>

<button>Enregistrer</button>
</form>
</div>
<script>
function calc(){recovery.value=(amount.value-fees.value)||0}
amount.oninput=fees.oninput=calc;calc();
</script>
</html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount=+req.body.amount||0, fees=+req.body.fees||0;
  const recoveryAmount=amount-fees;
  let t=await Transfert.findOne({code:req.body.code});
  if(t) await Transfert.findByIdAndUpdate(t._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount}).save();
  res.redirect('/transferts/list');
});

// ================= DASHBOARD =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
const all=await Transfert.find();
let f=all;

if(req.query.searchPhone)
f=f.filter(t=>t.senderPhone.includes(req.query.searchPhone)||t.receiverPhone.includes(req.query.searchPhone));
if(req.query.searchCode)
f=f.filter(t=>t.code.includes(req.query.searchCode));
if(req.query.searchName)
f=f.filter(t=>(t.receiverFirstName+t.receiverLastName).toLowerCase().includes(req.query.searchName.toLowerCase()));
if(req.query.destination && req.query.destination!=='all')
f=f.filter(t=>t.destinationLocation===req.query.destination);

const destinations=[...new Set(all.map(t=>t.destinationLocation))];
const retired=f.filter(t=>t.retired).length;
const notRetired=f.length-retired;

res.send(`<html>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{background:#f4f6f9;font-family:Arial}
.search-bar{display:flex;gap:10px;flex-wrap:wrap}
canvas{max-width:350px;margin:auto}
.card{background:white;padding:15px;border-radius:12px;margin:10px}
</style>
<h2>📊 Dashboard</h2>
<form class="search-bar">
<input name="searchPhone" placeholder="Téléphone">
<input name="searchCode" placeholder="Code">
<input name="searchName" placeholder="Nom">
<select name="destination">
<option value="all">Toutes destinations</option>
${destinations.map(d=>`<option>${d}</option>`).join('')}
</select>
<button>🔍</button>
</form>

<canvas id="pieChart" height="70"></canvas>

${f.map(t=>`<div class="card">
<b>${t.code}</b> – ${t.receiverFirstName} ${t.receiverLastName} – ${t.destinationLocation}
</div>`).join('')}

<script>
new Chart(document.getElementById('pieChart'),{
type:'pie',
data:{labels:['Retirés','Non retirés'],
datasets:[{data:[${retired},${notRetired}],backgroundColor:['#dc3545','#28a745']}]},
options:{plugins:{legend:{position:'bottom'}}}
});
</script>
</html>`);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

// ================= SERVER =================
app.listen(3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
