/******************************************************************
 * APP TRANSFERT + STOCKS + CLIENTS + RATES + EXPORT + HISTORY
 * DASHBOARD COMPLET AVEC AJAX ET FORMULAIRES MODALS JOLIS
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ================= SESSION ================= */
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*8 } // 8h
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(err=>{console.error(err); process.exit(1); });

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  senderFirstName:String, receiverFirstName:String, senderPhone:String, receiverPhone:String,
  originLocation:String, destinationLocation:String,
  amount:Number, fees:Number, received:Number, currency:{type:String,default:'GNF'},
  retired:{type:Boolean,default:false}, code:{type:String,unique:true}, createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockHistorySchema = new mongoose.Schema({
  code:String, sender:String, senderPhone:String, destination:String, destinationPhone:String,
  amount:Number, currency:String, date:{type:Date,default:Date.now}
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

const clientSchema = new mongoose.Schema({
  firstName:String, lastName:String, phone:String, kycVerified:{type:Boolean,default:false}, createdAt:{type:Date,default:Date.now}
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({
  from:String, to:String, rate:Number, createdAt:{type:Date,default:Date.now}
});
const Rate = mongoose.model('Rate', rateSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String,default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter=String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number=Math.floor(100+Math.random()*900);
    code=`${letter}${number}`;
    exists=await Transfert.findOne({code}) || await StockHistory.findOne({code});
  }
  return code;
}

const requireLogin=(req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
  .login-container button:hover{background:#e67300;}
  </style></head><body>
  <div class="login-container">
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Se connecter</button>
  </form>
  </div></body></html>`);
});

app.post('/login', async(req,res)=>{
  try{
    const {username,password}=req.body;
    let user=await Auth.findOne({username});
    if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user={ username:user.username, role:user.role };
    res.redirect('/dashboard');
  }catch(err){ console.error(err); res.status(500).send('Erreur'); }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

/* ================= DASHBOARD FINAL ================= */
app.get('/dashboard', requireLogin, async(req,res)=>{
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard Transfert</title>
<style>
:root{--primary:#ff8c42;--bg:#f4f6f9;--card:#fff;--danger:#e74c3c;--success:#2ecc71;}
body{margin:0;font-family:Segoe UI, Arial, sans-serif;background:var(--bg);}
header{background:linear-gradient(135deg,var(--primary),#ffa64d);color:white;padding:18px 30px;display:flex;justify-content:space-between;align-items:center;}
header h1{margin:0;font-size:22px}
.container{padding:25px}
.card{background:var(--card);border-radius:16px;padding:20px;box-shadow:0 8px 25px rgba(0,0,0,.08);margin-bottom:25px;}
.card h2{margin-top:0}
button{border:none;padding:10px 16px;border-radius:10px;cursor:pointer;font-weight:600;}
.btn-primary{background:var(--primary);color:white}
.btn-danger{background:var(--danger);color:white}
.btn-success{background:var(--success);color:white}
table{width:100%;border-collapse:collapse;}
th{background:var(--primary);color:white;padding:12px;text-align:left;}
td{padding:10px;border-bottom:1px solid #eee}
tr:hover{background:#fafafa}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);justify-content:center;align-items:center;z-index:1000;}
.modal-content{background:white;border-radius:20px;width:90%;max-width:500px;padding:25px;animation:fade .3s ease;}
@keyframes fade{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}
.modal-content h3{margin-top:0;text-align:center;color:var(--primary);}
input,select{width:100%;padding:12px;border-radius:10px;border:1px solid #ccc;margin-bottom:12px;}
.form-actions{display:flex;justify-content:space-between;gap:10px;}
.toast{position:fixed;bottom:20px;right:20px;background:#333;color:white;padding:12px 18px;border-radius:10px;opacity:0;transition:.3s;}
.toast.show{opacity:1}
</style>
</head>
<body>
<header>
  <h1>📊 Dashboard</h1>
  <div>
    <button class="btn-primary" onclick="exportPDF()">PDF</button>
    <button class="btn-primary" onclick="exportExcel()">Excel</button>
    <a href="/logout" style="color:white;margin-left:15px">Déconnexion</a>
  </div>
</header>

<div class="container">

<!-- TRANSFERTS -->
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>💸 Transferts</h2>
    <button class="btn-primary" onclick="openTransfertModal()">➕ Nouveau</button>
  </div>
  <table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="transfertBody"></tbody></table>
</div>

<!-- STOCKS -->
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>📦 Stocks</h2>
    <button class="btn-primary" onclick="openStockModal()">➕ Nouveau</button>
  </div>
  <table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr></thead>
  <tbody id="stockBody"></tbody></table>
</div>

<!-- CLIENTS -->
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>👤 Clients</h2>
    <button class="btn-primary" onclick="openClientModal()">➕ Nouveau</button>
  </div>
  <table><thead><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>KYC</th><th>Actions</th></tr></thead>
  <tbody id="clientBody"></tbody></table>
</div>

<!-- RATES -->
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h2>💱 Taux de change</h2>
    <button class="btn-primary" onclick="openRateModal()">➕ Nouveau</button>
  </div>
  <table><thead><tr><th>De</th><th>Vers</th><th>Rate</th><th>Actions</th></tr></thead>
  <tbody id="rateBody"></tbody></table>
</div>

</div>

<!-- MODALS -->
<!-- TRANSFERT -->
<div id="transfertModal" class="modal">
<div class="modal-content">
<h3>Transfert</h3>
<input id="t_origin" placeholder="Origine">
<input id="t_sender" placeholder="Nom expéditeur">
<input id="t_senderPhone" placeholder="Téléphone expéditeur">
<input id="t_destination" placeholder="Destination">
<input id="t_receiver" placeholder="Nom destinataire">
<input id="t_receiverPhone" placeholder="Téléphone destinataire">
<input id="t_amount" type="number" placeholder="Montant">
<input id="t_fees" type="number" placeholder="Frais">
<select id="t_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
<select id="t_recoveryMode"><option>ESPECE</option><option>TRANSFERT</option><option>VIREMENT</option></select>
<div class="form-actions">
<button class="btn-success" onclick="saveTransfert()">💾</button>
<button class="btn-danger" onclick="closeTransfertModal()">✖</button>
</div></div>
</div>

<!-- STOCK -->
<div id="stockModal" class="modal">
<div class="modal-content">
<h3>Stock</h3>
<input id="s_sender" placeholder="Expéditeur">
<input id="s_senderPhone" placeholder="Téléphone expéditeur">
<input id="s_destination" placeholder="Destination">
<input id="s_destinationPhone" placeholder="Téléphone destination">
<input id="s_amount" type="number" placeholder="Montant">
<select id="s_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
<div class="form-actions"><button class="btn-success" onclick="saveStock()">💾</button><button class="btn-danger" onclick="closeStockModal()">✖</button></div>
</div></div>

<!-- CLIENT -->
<div id="clientModal" class="modal">
<div class="modal-content">
<h3>Client</h3>
<input id="c_firstName" placeholder="Prénom">
<input id="c_lastName" placeholder="Nom">
<input id="c_phone" placeholder="Téléphone">
<select id="c_kyc"><option value="false">KYC ❌</option><option value="true">KYC ✅</option></select>
<div class="form-actions"><button class="btn-success" onclick="saveClient()">💾</button><button class="btn-danger" onclick="closeClientModal()">✖</button></div>
</div></div>

<!-- RATE -->
<div id="rateModal" class="modal">
<div class="modal-content">
<h3>Taux</h3>
<input id="r_from" placeholder="De">
<input id="r_to" placeholder="Vers">
<input id="r_rate" type="number" step="0.0001" placeholder="Rate">
<div class="form-actions"><button class="btn-success" onclick="saveRate()">💾</button><button class="btn-danger" onclick="closeRateModal()">✖</button></div>
</div></div>

<div id="toast" class="toast"></div>

<script>
let currentTransfertId=null,currentStockId=null,currentClientId=null,currentRateId=null;

function toast(msg){const t=document.getElementById('toast');t.innerText=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
async function loadTransferts(){const r=await fetch('/api/transferts');const d=await r.json();transfertBody.innerHTML='';d.forEach(t=>{transfertBody.innerHTML+=\`<tr><td>\${t.code}</td><td>\${t.senderFirstName}</td><td>\${t.receiverFirstName}</td><td>\${t.amount} \${t.currency}</td><td>\${t.retired?'✅ Retiré':'⏳'}</td><td><button class="btn-success" onclick="editTransfert('\${t._id}')">✏️</button><button class="btn-danger" onclick="deleteTransfert('\${t._id}')">❌</button></td></tr>\`})}
async function loadStocks(){const r=await fetch('/api/stocks');const d=await r.json();stockBody.innerHTML='';d.forEach(s=>{stockBody.innerHTML+=\`<tr><td>\${s.code}</td><td>\${s.sender}</td><td>\${s.destination}</td><td>\${s.amount}</td><td>\${s.currency}</td><td><button class="btn-danger" onclick="deleteStock('\${s._id}')">❌</button></td></tr>\`})}
async function loadClients(){const r=await fetch('/api/clients');const d=await r.json();clientBody.innerHTML='';d.forEach(c=>{clientBody.innerHTML+=\`<tr><td>\${c.lastName}</td><td>\${c.firstName}</td><td>\${c.phone}</td><td>\${c.kycVerified?'✅':'❌'}</td><td><button class="btn-danger" onclick="deleteClient('\${c._id}')">❌</button></td></tr>\`})}
async function loadRates(){const r=await fetch('/api/rates');const d=await r.json();rateBody.innerHTML='';d.forEach(r=>{rateBody.innerHTML+=\`<tr><td>\${r.from}</td><td>\${r.to}</td><td>\${r.rate}</td><td><button class="btn-danger" onclick="deleteRate('\${r._id}')">❌</button></td></tr>\`})}

window.onload=()=>{loadTransferts();loadStocks();loadClients();loadRates();}

async function saveTransfert(){await fetch('/transfert/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({_id:currentTransfertId,originLocation:t_origin.value,senderFirstName:t_sender.value,senderPhone:t_senderPhone.value,destinationLocation:t_destination.value,receiverFirstName:t_receiver.value,receiverPhone:t_receiverPhone.value,amount:+t_amount.value,fees:+t_fees.value,received:+t_amount.value-+t_fees.value,currency:t_currency.value,recoveryMode:t_recoveryMode.value})});closeTransfertModal();loadTransferts();toast('Transfert enregistré');}
async function saveStock(){await fetch('/stock/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sender:s_sender.value,senderPhone:s_senderPhone.value,destination:s_destination.value,destinationPhone:s_destinationPhone.value,amount:+s_amount.value,currency:s_currency.value})});closeStockModal();loadStocks();toast('Stock enregistré');}
async function saveClient(){await fetch('/client/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:c_firstName.value,lastName:c_lastName.value,phone:c_phone.value,kycVerified:c_kyc.value==='true'})});closeClientModal();loadClients();toast('Client enregistré');}
async function saveRate(){await fetch('/rate/new',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:r_from.value,to:r_to.value,rate:+r_rate.value})});closeRateModal();loadRates();toast('Taux enregistré');}

function closeTransfertModal(){transfertModal.style.display='none'}function closeStockModal(){stockModal.style.display='none'}function closeClientModal(){clientModal.style.display='none'}function closeRateModal(){rateModal.style.display='none'}
function openTransfertModal(){transfertModal.style.display='flex'}function openStockModal(){stockModal.style.display='flex'}function openClientModal(){clientModal.style.display='flex'}function openRateModal(){rateModal.style.display='flex'}

/* Export placeholders */
function exportPDF(){toast('PDF export non implémenté');}
function exportExcel(){toast('Excel export non implémenté');}
</script>
</body>
</html>`);
});

/* ================= API AJAX ================= */
app.get('/api/transferts', requireLogin, async(req,res)=>res.json(await Transfert.find().sort({createdAt:-1})));
app.get('/api/stocks', requireLogin, async(req,res)=>res.json(await StockHistory.find().sort({date:-1})));
app.get('/api/clients', requireLogin, async(req,res)=>res.json(await Client.find().sort({createdAt:-1})));
app.get('/api/rates', requireLogin, async(req,res)=>res.json(await Rate.find().sort({createdAt:-1})));

/* ================= CRUD POST ================= */
app.post('/transfert/new', requireLogin, async(req,res)=>{
  const {originLocation,senderFirstName,senderPhone,destinationLocation,receiverFirstName,receiverPhone,amount,fees,received,currency,recoveryMode,_id}=req.body;
  if(_id){ await Transfert.findByIdAndUpdate(_id,{originLocation,senderFirstName,senderPhone,destinationLocation,receiverFirstName,receiverPhone,amount,fees,received,currency,recoveryMode}); }
  else{ const code=await generateUniqueCode(); await new Transfert({originLocation,senderFirstName,senderPhone,destinationLocation,receiverFirstName,receiverPhone,amount,fees,received,currency,recoveryMode,code}).save(); }
  res.json({ok:true});
});
app.post('/stock/new', requireLogin, async(req,res)=>{ const code=await generateUniqueCode(); await new StockHistory({...req.body,code}).save(); res.json({ok:true}); });
app.post('/client/new', requireLogin, async(req,res)=>{ await new Client(req.body).save(); res.json({ok:true}); });
app.post('/rate/new', requireLogin, async(req,res)=>{ await new Rate(req.body).save(); res.json({ok:true}); });

/* ================= DELETE ================= */
app.delete('/transfert/:id', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.params.id); res.json({ok:true}); });
app.delete('/stock/:id', requireLogin, async(req,res)=>{ await StockHistory.findByIdAndDelete(req.params.id); res.json({ok:true}); });
app.delete('/client/:id', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.params.id); res.json({ok:true}); });
app.delete('/rate/:id', requireLogin, async(req,res)=>{ await Rate.findByIdAndDelete(req.params.id); res.json({ok:true}); });

/* ================= START ================= */
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Dashboard actif sur http://localhost:${PORT}`));
