/******************************************************************
 * APP TRANSFERT – TOUT EN UN – RENDER READY – STOCK + AJAX
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
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: false
}));

/* ===================== DATABASE ===================== */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{
  console.error('❌ MongoDB erreur', err.message);
  process.exit(1);
});

/* ===================== SCHEMAS ===================== */

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
  retired:{type:Boolean,default:false},
  retraitHistory:[{date:Date,mode:String}],
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String,default:'admin'}
});
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  location:String,
  currency:String,
  balance:{type:Number,default:0}
});
const Stock = mongoose.model('Stock', stockSchema);

/* ===================== CONSTANTES ===================== */

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

/* ===================== UTILS ===================== */

async function generateCode(){
  let code, ok=false;
  while(!ok){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    ok = !(await Transfert.findOne({code}));
  }
  return code;
}

const requireLogin=(req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ===================== LOGIN ===================== */

app.get('/login',(req,res)=>{
res.send(`
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.box{background:#fff;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.3);width:90%;max-width:360px}
h2{text-align:center;color:#ff8c42}
input,button{width:100%;padding:15px;margin-top:12px;border-radius:10px;font-size:16px}
input{border:1px solid #ccc}
button{border:none;background:#ff8c42;color:white;font-weight:bold}
</style>
</head><body>
<div class="box">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div>
</body></html>
`);
});

app.post('/login',async(req,res)=>{
let user = await Auth.findOne({username:req.body.username});
if(!user){
  user = await new Auth({
    username:req.body.username,
    password:bcrypt.hashSync(req.body.password,10)
  }).save();
}
if(!bcrypt.compareSync(req.body.password,user.password)) return res.send('Mot de passe incorrect');
req.session.user={username:user.username};
res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ===================== FORM TRANSFERT ===================== */

app.get('/transferts/form',requireLogin,async(req,res)=>{
const t=req.query.code?await Transfert.findOne({code:req.query.code}):null;
const code=t?t.code:await generateCode();
res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f4f8;padding:10px}
.container{max-width:900px;margin:auto;background:white;padding:20px;border-radius:15px}
h2{text-align:center;color:#ff8c42}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
input,select,button{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%}
button{background:#ff8c42;color:white;border:none;font-weight:bold}
</style></head><body>
<div class="container">
<h2>${t?'Modifier':'Nouveau'} Transfert</h2>
<form method="post">
<input type="hidden" name="code" value="${code}">
<select name="userType">
<option>Client</option><option>Distributeur</option><option>Administrateur</option><option>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" placeholder="Prénom" value="${t?.senderFirstName||''}" required>
<input name="senderLastName" placeholder="Nom" value="${t?.senderLastName||''}" required>
<input name="senderPhone" placeholder="Téléphone" value="${t?.senderPhone||''}" required>
<select name="originLocation">${locations.map(l=>`<option ${t?.originLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" placeholder="Prénom" value="${t?.receiverFirstName||''}" required>
<input name="receiverLastName" placeholder="Nom" value="${t?.receiverLastName||''}" required>
<input name="receiverPhone" placeholder="Téléphone" value="${t?.receiverPhone||''}" required>
<select name="destinationLocation">${locations.map(l=>`<option ${t?.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select>
</div>

<h3>Montants</h3>
<div class="grid">
<input type="number" id="amount" name="amount" value="${t?.amount||0}">
<input type="number" id="fees" name="fees" value="${t?.fees||0}">
<input id="recovery" readonly>
<select name="currency">${currencies.map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`).join('')}</select>
</div>

<select name="recoveryMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select>
<button>Enregistrer</button>
</form>
<a href="/transferts/list">⬅ Retour</a>
</div>

<script>
const a=document.getElementById('amount'),f=document.getElementById('fees'),r=document.getElementById('recovery');
function u(){r.value=(+a.value||0)-(+f.value||0)}a.oninput=f.oninput=u;u();
</script>
</body></html>
`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
const amount=+req.body.amount,fees=+req.body.fees;
const recoveryAmount=amount-fees;
const data={...req.body,amount,fees,recoveryAmount};
let t=await Transfert.findOne({code:req.body.code});
if(t) await Transfert.findByIdAndUpdate(t._id,data);
else await new Transfert(data).save();
res.redirect('/transferts/list');
});

/* ===================== LISTE + AJAX ===================== */

app.get('/transferts/list',requireLogin,async(req,res)=>{
let list=await Transfert.find().sort({createdAt:-1});
res.send(`
<html><body>
<h2>Liste des transferts</h2>
<a href="/transferts/form">➕ Nouveau</a> | <a href="/logout">Déconnexion</a>
<table border="1" cellpadding="5">
<tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th></tr>
${list.map(t=>`
<tr data-id="${t._id}">
<td>${t.code}</td>
<td>${t.senderFirstName}</td>
<td>${t.receiverFirstName}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<a href="/transferts/form?code=${t.code}">✏️</a>
<button onclick="del('${t._id}')">❌</button>
${!t.retired?`<button onclick="ret('${t._id}')">💰</button>`:''}
</td>
</tr>`).join('')}
</table>

<script>
function del(id){fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(()=>location.reload())}
function ret(id){fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:'Espèces'})}).then(()=>location.reload())}
</script>
</body></html>
`);
});

/* ===================== AJAX ===================== */

app.post('/transferts/retirer',requireLogin,async(req,res)=>{
await Transfert.findByIdAndUpdate(req.body.id,{retired:true,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
res.send({ok:true});
});
app.post('/transferts/delete',requireLogin,async(req,res)=>{
await Transfert.findByIdAndDelete(req.body.id);
res.send({ok:true});
});

/* ===================== SERVER ===================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur lancé sur ${PORT}`));
