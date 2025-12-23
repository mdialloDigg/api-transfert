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
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,
  amount:Number,
  fees:Number,
  feePercent:Number,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,
  recoveryAmount:Number,
  recoveryMode:String,
  code:String,
  retired:{type:Boolean,default:false},
  retraitHistory:[{date:Date,mode:String}],
  createdAt:{type:Date,default:Date.now}
});
const User = mongoose.model('User', userSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String
});
const AuthUser = mongoose.model('AuthUser', authSchema);

/* ================= AUTH MIDDLEWARE ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.userId) return next();
  res.redirect('/login');
};

/* ================= AUTH ================= */
app.get('/login',(req,res)=>{
res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:80px">
<h2>🔐 Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form></body></html>`);
});

app.post('/login',async(req,res)=>{
  const u=await AuthUser.findOne({username:req.body.username});
  if(!u || !bcrypt.compareSync(req.body.password,u.password))
    return res.send("❌ Identifiants incorrects");
  req.session.userId=u._id;
  res.redirect('/users');
});

app.get('/register',async(req,res)=>{
  const hash=bcrypt.hashSync('admin123',10);
  await new AuthUser({username:'admin',password:hash}).save();
  res.send("✅ Admin créé : admin / admin123");
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= FORM ACCESS ================= */
app.get('/users',requireLogin,(req,res)=>{
if(!req.session.formAccess){
return res.send(`<html><body style="text-align:center;padding-top:80px">
<h3>🔒 Code formulaire</h3>
<form method="post" action="/auth/form">
<input type="password" name="code" placeholder="123" required>
<button>Valider</button>
</form></body></html>`);
}
res.redirect('/users/choice');
});

app.post('/auth/form',(req,res)=>{
if(req.body.code==='123') req.session.formAccess=true;
res.redirect('/users/choice');
});

/* ================= CHOIX ================= */
app.get('/users/choice',requireLogin,(req,res)=>{
res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:60px">
<h2>📋 Gestion transferts</h2>
<a href="/users/lookup?mode=new"><button>Nouveau</button></a><br><br>
<a href="/users/lookup?mode=edit"><button>Modifier</button></a><br><br>
<a href="/users/lookup?mode=delete"><button>Supprimer</button></a><br><br>
<a href="/users/all"><button>📊 Liste</button></a><br><br>
<a href="/logout">🚪 Déconnexion</a>
</body></html>`);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup',requireLogin,(req,res)=>{
req.session.choiceMode=req.query.mode;
res.send(`<html><body style="text-align:center;padding-top:80px">
<h3>📞 Téléphone expéditeur</h3>
<form method="post">
<input name="phone" required>
<button>Continuer</button>
</form></body></html>`);
});

app.post('/users/lookup',requireLogin,async(req,res)=>{
const u=await User.findOne({senderPhone:req.body.phone}).sort({createdAt:-1});
req.session.prefill=u||{senderPhone:req.body.phone};
req.session.editId=u?u._id:null;

if(req.session.choiceMode==='delete' && u){
await User.findByIdAndDelete(u._id);
return res.send("❌ Supprimé <a href='/users/choice'>Retour</a>");
}
res.redirect('/users/form');
});

/* ================= FORM ================= */
app.get('/users/form',requireLogin,(req,res)=>{
const u=req.session.prefill||{};
const isEdit=!!req.session.editId;
res.send(`<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width">
<style>
body{font-family:Arial;background:#eef2f7}
form{background:#fff;max-width:900px;margin:20px auto;padding:15px;border-radius:8px}
input,select,button{width:100%;padding:8px;margin-top:8px}
</style></head>
<body>
<form id="f">
<h3>${isEdit?'✏️ Modifier':'💸 Nouveau'} transfert</h3>
<input id="senderPhone" value="${u.senderPhone||''}" placeholder="Téléphone">
<input id="amount" type="number" value="${u.amount||''}" placeholder="Montant">
<input id="fees" type="number" value="${u.fees||''}" placeholder="Frais">
<input id="recoveryAmount" value="${u.recoveryAmount||''}" placeholder="Montant reçu" readonly>
<button>${isEdit?'Mettre à jour':'Enregistrer'}</button>
<p id="msg"></p>
</form>
<script>
amount.oninput=fees.oninput=()=>recoveryAmount.value=(+amount.value||0)-(+fees.value||0);
f.onsubmit=async e=>{
e.preventDefault();
const r=await fetch('${isEdit?'/users/update':'/users'}',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({senderPhone:senderPhone.value,amount:+amount.value,fees:+fees.value,recoveryAmount:+recoveryAmount.value})});
msg.innerText=(await r.json()).message;
}
</script></body></html>`);
});

/* ================= CRUD ================= */
app.post('/users',requireLogin,async(req,res)=>{
const code=Math.floor(100000+Math.random()*900000).toString();
await new User({...req.body,code}).save();
res.json({message:'✅ Enregistré | Code '+code});
});

app.post('/users/update',requireLogin,async(req,res)=>{
await User.findByIdAndUpdate(req.session.editId,req.body);
res.json({message:'✏️ Modifié'});
});

/* ================= LISTE + RETRAIT ================= */
app.get('/users/all',requireLogin,async(req,res)=>{
const users=await User.find().sort({createdAt:1});
let html=`<html><head><style>
body{font-family:Arial}
table{width:95%;margin:auto;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:6px;text-align:center}
.retired{background:orange}
</style></head><body>
<h2 style="text-align:center">📊 Liste transferts</h2>
<table><tr><th>Tél</th><th>Montant</th><th>Reçu</th><th>Code</th><th>Action</th></tr>`;

users.forEach(u=>{
html+=`<tr class="${u.retired?'retired':''}">
<td>${u.senderPhone}</td>
<td>${u.amount}</td>
<td>${u.recoveryAmount}</td>
<td>${u.code}</td>
<td>${u.retired?'Retiré':`<button onclick="retirer('${u._id}',this)">💰 Retirer</button>`}</td>
</tr>`;
});

html+=`</table>

<script>
function retirer(id,btn){
const modal=document.createElement('div');
modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
modal.innerHTML=\`
<div style="background:#fff;padding:30px;border-radius:10px;width:320px">
<h3>💰 Retrait</h3>
<select id="mode" style="width:100%;padding:10px">
<option value="">Choisir</option>
<option>Espèces</option>
<option>Orange Money</option>
<option>Produit</option>
<option>Service</option>
</select><br><br>
<button onclick="confirm()">Valider</button>
<button onclick="this.parentElement.parentElement.remove()">Annuler</button>
</div>\`;
document.body.appendChild(modal);
window.confirm=async()=>{
const mode=document.getElementById('mode').value;
if(!mode)return alert('Choisir un mode');
await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
location.reload();
}
}
</script>
<br><center><a href="/users/export/pdf">📄 Export PDF</a></center>
</body></html>`;
res.send(html);
});

/* ================= RETRAIT ================= */
app.post('/users/retirer',requireLogin,async(req,res)=>{
const u=await User.findById(req.body.id);
u.retired=true;
u.recoveryMode=req.body.mode;
u.retraitHistory.push({date:new Date(),mode:req.body.mode});
await u.save();
res.json({message:'💰 Retiré'});
});

/* ================= PDF PRO ================= */
app.get('/users/export/pdf',requireLogin,async(req,res)=>{
const users=await User.find();
const doc=new PDFDocument({margin:40});
res.setHeader('Content-Type','application/pdf');
doc.pipe(res);
doc.fontSize(20).text('📊 Rapport des transferts',{align:'center'});
doc.moveDown();
users.forEach(u=>{
doc.fontSize(12).text(`Téléphone: ${u.senderPhone}`);
doc.text(`Montant: ${u.amount} | Reçu: ${u.recoveryAmount}`);
doc.text(`Code: ${u.code} | Mode: ${u.recoveryMode||'-'}`);
doc.moveDown().moveTo(40,doc.y).lineTo(550,doc.y).stroke();
});
doc.end();
});

/* ================= SERVER ================= */
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Server Render OK'));
