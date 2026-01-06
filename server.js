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

// ================= SESSION =================
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*8 } // 8h
}));

// ================= DATABASE =================
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(err=>{console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType:{type:String,enum:['Client','Distributeur','Administrateur','Agence de transfert'],required:true},
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
  received:Number,
  currency:{type:String,enum:['GNF','EUR','USD','XOF'],default:'GNF'},
  recoveryMode:String,
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const stockSchema = new mongoose.Schema({
  code:{type:String,unique:true},
  sender:String,
  senderPhone:String,
  destination:String,
  destinationPhone:String,
  amount:Number,
  currency:{type:String,default:'GNF'},
  createdAt:{type:Date,default:Date.now}
});
const Stock = mongoose.model('Stock',stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code:String,
  action:String,
  stockId:mongoose.Schema.Types.ObjectId,
  sender:String,
  senderPhone:String,
  destination:String,
  destinationPhone:String,
  amount:Number,
  balance:Number,
  currency:String,
  date:{type:Date,default:Date.now}
});
const StockHistory = mongoose.model('StockHistory',stockHistorySchema);

const clientSchema = new mongoose.Schema({
  firstName:String,
  lastName:String,
  phone:String,
  email:String,
  kycVerified:{type:Boolean,default:false},
  createdAt:{type:Date,default:Date.now}
});
const Client = mongoose.model('Client',clientSchema);

const rateSchema = new mongoose.Schema({
  from:String,
  to:String,
  rate:Number,
  createdAt:{type:Date,default:Date.now}
});
const Rate = mongoose.model('Rate',rateSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String,enum:['admin','agent'],default:'agent'}
});
const Auth = mongoose.model('Auth',authSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code,exists=true;
  while(exists){
    const letter = String.fromCharCode(65+Math.floor(Math.random()*26));
    const number = Math.floor(100+Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin=(req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

function setPermissions(username){
  if(username==='a'){return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};}
  if(username==='admin2'){return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};}
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
  .login-container button:hover{background:#e67300;}
  </style></head><body>
  <div class="login-container"><h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Se connecter</button>
  </form>
  </div></body></html>`);
});

app.post('/login',async(req,res)=>{
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save();}
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role,permissions:setPermissions(username)};
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});

// ================= DASHBOARD =================
app.get('/dashboard',requireLogin,async(req,res)=>{
  const filters={};
  const q=req.query;
  if(q.code) filters.code=q.code.toUpperCase();
  if(q.currency) filters.currency=q.currency;
  if(q.status!==undefined && q.status!=='') filters.retired = q.status==='true';
  if(q.sender) filters.senderFirstName={$regex:q.sender,$options:'i'};
  if(q.receiver) filters.receiverFirstName={$regex:q.receiver,$options:'i'};
  if(q.dateFrom || q.dateTo){filters.createdAt={};if(q.dateFrom) filters.createdAt.$gte=new Date(q.dateFrom);if(q.dateTo) filters.createdAt.$lte=new Date(q.dateTo+'T23:59:59');}

  const transferts = await Transfert.find(filters).sort({createdAt:-1});
  const stocks = await StockHistory.find().sort({createdAt:-1});
  //const stockHistory = await StockHistory.find().sort({date:-1});
  const stockHistory = await StockHistory.find().sort({createdAt:-1});
  const clients = await Client.find().sort({createdAt:-1});
  const rates = await Rate.find().sort({createdAt:-1});
  const p = req.session.user.permissions;

  // === HTML complet avec toutes les colonnes et modals ===
  // [INSÉRER ICI LE BLOC HTML/JS DE MON MESSAGE PRÉCÉDENT]
let html = `
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
h2,h3,h4{margin-top:20px;color:#333;}
a{margin-right:10px;text-decoration:none;color:#007bff;}
table{border-collapse:collapse;width:100%;margin-bottom:20px;}
th,td{border:1px solid #ccc;padding:8px;text-align:left;}
th{background:#ff8c42;color:white;}
button{margin:2px;padding:5px 10px;cursor:pointer;}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
.modal-content{background:white;padding:20px;border-radius:10px;max-width:500px;width:90%;overflow:auto;}
input,select{width:100%;padding:6px;margin-bottom:10px;}
</style>
</head>
<body>

<h2>📊 Dashboard</h2>
<a href="/logout">🚪 Déconnexion</a>
<button onclick="exportPDF()">📄 Export PDF</button>
<button onclick="exportExcel()">📊 Export Excel</button>

<!-- ================== FILTRE RECHERCHE ================== -->
<h3>Recherche Transfert</h3>
<input id="f_code" placeholder="Code">
<input id="f_sender" placeholder="Nom expéditeur">
<input id="f_receiver" placeholder="Nom destinataire">
<input id="f_currency" placeholder="Devise">
<select id="f_status">
<option value="">Status</option>
<option value="true">Retiré</option>
<option value="false">Non retiré</option>
</select>
<input type="date" id="f_date_from" placeholder="Date début">
<input type="date" id="f_date_to" placeholder="Date fin">
<button onclick="searchTransferts()">🔍 Rechercher</button>

<!-- ================== TRANSFERTS ================== -->
<h3>Transferts</h3>
${p.ecriture?`<button onclick="openTransfertModal()">➕ Nouveau Transfert</button>`:''}
<table>
<tr>
<th>Code</th>
<th>Origine</th>
<th>Expéditeur</th>
<th>Tel Expéditeur</th>
<th>Destination</th>
<th>Destinataire</th>
<th>Tel Destinataire</th>
<th>Montant</th>
<th>Frais</th>
<th>Reçu</th>
<th>Devise</th>
<th>Mode récupération</th>
<th>Status</th>
<th>Date création</th>
<th>Actions</th>
</tr>
${transferts.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.originLocation}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone||'-'}</td>
<td>${t.destinationLocation}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone||'-'}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.received}</td>
<td>${t.currency}</td>
<td>${t.recoveryMode||'-'}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>${new Date(t.createdAt).toLocaleString()}</td>
<td>
${p.modification?`<button onclick="openTransfertModal('${t._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteTransfert('${t._id}')">❌</button>`:''}
${(!t.retired && p.retrait)?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
${p.imprimer?`<button onclick="window.open('/transfert/print/${t._id}','_blank')">🖨</button>`:''}
</td>
</tr>
`).join('')}
</table>

<!-- ================== STOCKS ================== -->
<h3>Stocks</h3>
<button onclick="openStockModal()">➕ Nouveau Stock</button>
<table>
<tr>
<th>Code</th>
<th>Expéditeur</th>
<th>Tel Expéditeur</th>
<th>Destination</th>
<th>Tel Destination</th>
<th>Montant</th>
<th>Devise</th>
<th>Date création</th>
<th>Actions</th>
</tr>
${stockHistory.map(s=>`
<tr>
<td>${s.code}</td>
<td>${s.sender}</td>
<td>${s.senderPhone||'-'}</td>
<td>${s.destination}</td>
<td>${s.destinationPhone||'-'}</td>
<td>${s.amount}</td>
<td>${s.currency}</td>
<td>${new Date(s.createdAt).toLocaleString()}</td>
<td>
${p.modification?`<button onclick="openStockModal('${s._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteStock('${s._id}')">❌</button>`:''}
</td>
</tr>
`).join('')}
</table>





<!-- ================== CLIENTS ================== -->
<h3>Clients KYC</h3>
<button onclick="openClientModal()">➕ Nouveau Client</button>
<table>
<tr>
<th>Nom</th>
<th>Prénom</th>
<th>Téléphone</th>
<th>Email</th>
<th>KYC</th>
<th>Date création</th>
<th>Actions</th>
</tr>
${clients.map(c=>`
<tr>
<td>${c.lastName}</td>
<td>${c.firstName}</td>
<td>${c.phone}</td>
<td>${c.email||'-'}</td>
<td>${c.kycVerified?'✅':'❌'}</td>
<td>${new Date(c.createdAt).toLocaleString()}</td>
<td>
${p.modification?`<button onclick="openClientModal('${c._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteClient('${c._id}')">❌</button>`:''}
</td>
</tr>
`).join('')}
</table>

<!-- ================== RATES ================== -->
<h3>Taux de Change</h3>
<button onclick="openRateModal()">➕ Nouveau Taux</button>
<table>
<tr>
<th>De</th>
<th>Vers</th>
<th>Rate</th>
<th>Date création</th>
<th>Actions</th>
</tr>
${rates.map(r=>`
<tr>
<td>${r.from}</td>
<td>${r.to}</td>
<td>${r.rate}</td>
<td>${new Date(r.createdAt).toLocaleString()}</td>
<td>
${p.modification?`<button onclick="openRateModal('${r._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteRate('${r._id}')">❌</button>`:''}
</td>
</tr>
`).join('')}
</table>

<!-- ================== MODALS ================== -->
<div id="transfertModal" class="modal">
<div class="modal-content">
<h3>Transfert</h3>
<input id="t_code" readonly placeholder="Code">
<input id="t_origin" placeholder="Origine">
<input id="t_sender" placeholder="Nom expéditeur">
<input id="t_senderPhone"
       placeholder="00224XXXXXXXXX ou 0033XXXXXXXXX"
       pattern="^(00224\d{9}|0033\d{9})$"
       title="Format requis : 00224XXXXXXXX (Guinée) ou 0033XXXXXXXXXX (France)">
<input id="t_destination" placeholder="Destination">
<input id="t_receiver" placeholder="Nom destinataire">
<input id="t_receiverPhone"
       placeholder="00224XXXXXXXXX ou 0033XXXXXXXXX"
       pattern="^(00224\d{9}|0033\d{9})$"
       title="Format requis : 00224XXXXXXXXX (Guinée) ou 0033XXXXXXXXX (France)"
       required>
<input id="t_amount" type="number" placeholder="Montant">
<input id="t_fees" type="number" placeholder="Frais">
<input id="t_received" readonly placeholder="Reçu">
<select id="t_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
<select id="t_recoveryMode"><option>ESPECE</option><option>TRANSFERT</option><option>VIREMENT</option><option>AUTRE</option></select>
<button onclick="saveTransfert()">Enregistrer</button>
<button onclick="closeTransfertModal()">Fermer</button>
</div></div>

<div id="stockModal" class="modal">
<div class="modal-content">
<h3>Stock</h3>
<input id="s_code" readonly placeholder="Code">
<input id="s_sender" placeholder="Expéditeur">
<input id="s_senderPhone"
       placeholder="00224XXXXXXXXX ou 0033XXXXXXXXX"
       pattern="^(00224\d{9}|0033\d{9})$"
       title="Format requis : 00224XXXXXXXXX (Guinée) ou 0033XXXXXXXXX (France)"
       required>
<input id="s_destination" placeholder="Destination">
<input id="s_destinationPhone"
       placeholder="00224XXXXXXXXX ou 0033XXXXXXXXX"
       pattern="^(00224\d{9}|0033\d{9})$"
       title="Format requis : 00224XXXXXXXXX (Guinée) ou 0033XXXXXXXXX (France)"
       required>
<input id="s_amount" type="number" placeholder="Montant">
<select id="s_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
<button onclick="saveStock()">Enregistrer</button>
<button onclick="closeStockModal()">Fermer</button>
</div></div>

<div id="clientModal" class="modal">
<div class="modal-content">
<h3>Client KYC</h3>
<input id="c_firstName" placeholder="Prénom">
<input id="c_lastName" placeholder="Nom">
<input id="c_phone"
       placeholder="00224XXXXXXXXX ou 0033XXXXXXXXX"
       pattern="^(00224\d{9}|0033[67]\d{9})$"
       title="Format requis : 00224XXXXXXXXX (Guinée) ou 0033XXXXXXXXX (France)"
       required>
<input id="c_email" placeholder="Email">
<select id="c_kyc"><option value="false">Non</option><option value="true">Oui</option></select>
<button onclick="saveClient()">Enregistrer</button>
<button onclick="closeClientModal()">Fermer</button>
</div></div>

<div id="rateModal" class="modal">
<div class="modal-content">
<h3>Taux de Change</h3>
<input id="r_from" placeholder="De">
<input id="r_to" placeholder="Vers">
<input id="r_rate" type="number" step="0.0001" placeholder="Rate">
<button onclick="saveRate()">Enregistrer</button>
<button onclick="closeRateModal()">Fermer</button>
</div></div>

<script>
let currentTransfertId=null,currentStockId=null,currentClientId=null,currentRateId=null;

function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

function searchTransferts(){
const params=new URLSearchParams({code:f_code.value,sender:f_sender.value,receiver:f_receiver.value,currency:f_currency.value,status:f_status.value,dateFrom:f_date_from.value,dateTo:f_date_to.value});
window.location.href='/dashboard?'+params.toString();
}


function saveTransfert() {
  const senderPhoneClean = t_senderPhone.value.trim().replace(/\s+/g, '');
  const receiverPhoneClean = t_receiverPhone.value.trim().replace(/\s+/g, '');

  const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;

  if (!regex.test(senderPhoneClean)) {
    alert('Numéro expéditeur invalide ! Format : 00224XXXXXXXXX ou 00336/00337XXXXXXXX');
    return;
  }

  if (!regex.test(receiverPhoneClean)) {
    alert('Numéro destinataire invalide ! Format : 00224XXXXXXXXX ou 00336/00337XXXXXXXX');
    return;
  }

  const amount = parseFloat(t_amount.value) || 0;
  const fees = parseFloat(t_fees.value) || 0;

  postData('/transfert/new', {
    _id: currentTransfertId,
    originLocation: t_origin.value,
    senderFirstName: t_sender.value,
    senderPhone: senderPhoneClean,
    destinationLocation: t_destination.value,
    receiverFirstName: t_receiver.value,
    receiverPhone: receiverPhoneClean,
    amount,
    fees,
    received: amount - fees,
    currency: t_currency.value,
    recoveryMode: t_recoveryMode.value
  }).then((res) => {
    if (res.success) location.reload();
    else alert(res.error || 'Erreur serveur');
  });
}

/* Transfert */


function openTransfertModal(id = null) {
  currentTransfertId = id;
  document.getElementById('transfertModal').style.display = 'flex';

  // Nouveau
  if (!id) {
    t_code.value = '';
    t_origin.value = '';
    t_sender.value = '';
    t_senderPhone.value = '';
    t_destination.value = '';
    t_receiver.value = '';
    t_receiverPhone.value = '';
    t_amount.value = '';
    t_fees.value = '';
    t_received.value = '';
    return;
  }

  fetch('/transfert/' + id)
    .then(r => r.json())
    .then(t => {
      t_code.value = t.code;
      t_origin.value = t.originLocation;
      t_sender.value = t.senderFirstName;
      t_senderPhone.value = t.senderPhone;
      t_destination.value = t.destinationLocation;
      t_receiver.value = t.receiverFirstName;
      t_receiverPhone.value = t.receiverPhone;
      t_amount.value = t.amount;
      t_fees.value = t.fees;
      t_received.value = t.received;
      t_currency.value = t.currency;
      t_recoveryMode.value = t.recoveryMode;
    });
}

function closeTransfertModal(){
  document.getElementById('transfertModal').style.display='none';
  currentTransfertId=null;
}


function closeStockModal(){
  document.getElementById('stockModal').style.display='none';
  currentStockId=null;
}



/**
 * Vérifie si le numéro de téléphone est valide
 * Guinée : 00224 + 9 chiffres
 * France : 0033 + 9 chiffres, mobile commence par 6 ou 7
 */
/**************** PHONE MODULE ****************/

function cleanPhone(phone) {
  if (!phone) return '';
  return phone.toString().replace(/[\s\-().]/g, '');
}

function normalizePhone(phone) {
  phone = cleanPhone(phone);

  // Guinée
  if (phone.startsWith('+224')) phone = '00224' + phone.slice(4);
  if (phone.startsWith('224') && phone.length === 12) phone = '00224' + phone.slice(3);

  // France
  if (phone.startsWith('+33')) phone = '0033' + phone.slice(3);
  if (phone.startsWith('33') && phone.length === 11) phone = '0033' + phone.slice(2);
  if (phone.startsWith('0') && phone.length === 10) phone = '0033' + phone.slice(1);

  return phone;
}

function isValidPhone(phone) {
  phone = normalizePhone(phone);
  return (
    /^00224\d{9}$/.test(phone) ||   // Guinée
    /^0033\d{9}$/.test(phone)       // France
  );
}

/************************************************/



/**
 * test(phone)
 * Vérifie si un numéro de téléphone est valide
 * Guinée : 00224 + 9 chiffres
 * France : 0033 + 9 chiffres, mobile commence par 6 ou 7
 */
function test(phone) {
  if (!phone) return false;

  // 1️⃣ Nettoyage : enlever espaces et caractères invisibles
  phone = phone.toString().trim().replace(/\s+/g, '');

  // 2️⃣ Validation avec regex
  const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;

  return regex.test(phone);
}



function deleteTransfert(id){
  if(confirm('Supprimer ?'))
    postData('/transfert/delete',{id}).then(()=>location.reload());
}
function retirerTransfert(id){
  if(confirm('Marquer comme retiré ?'))
    postData('/transfert/retirer',{id,mode:'ESPECE'}).then(()=>location.reload());
}

/* ================= STOCK ================= */
function openStockModal(id = null) {
  currentStockId = id;
  document.getElementById('stockModal').style.display = 'flex';

  if (!id) {
    s_code.value = '';
    s_sender.value = '';
    s_senderPhone.value = '';
    s_destination.value = '';
    s_destinationPhone.value = '';
    s_amount.value = '';
    return;
  }

  fetch('/stock/' + id)  // <-- ici
    .then(r => r.json())
    .then(s => {
      s_code.value = s.code;
      s_sender.value = s.sender;
      s_senderPhone.value = s.senderPhone;
      s_destination.value = s.destination;
      s_destinationPhone.value = s.destinationPhone;
      s_amount.value = s.amount;
      s_currency.value = s.currency;
    });
}

function saveClient() {
  const phoneClean = c_phone.value.trim().replace(/\s+/g, '');
  const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;

  if (!regex.test(phoneClean)) {
    alert('Numéro téléphone invalide ! Format : 00224XXXXXXXXX ou 00336/00337XXXXXXXX');
    return;
  }

  postData('/client/new', {
    _id: currentClientId,
    firstName: c_firstName.value,
    lastName: c_lastName.value,
    phone: phoneClean,
    email: c_email.value,
    kycVerified: c_kyc.value === 'true'
  }).then((res) => {
    if (res.success) location.reload();
    else alert(res.error || 'Erreur serveur');
  });
}


function saveStock() {
  const senderPhoneClean = s_senderPhone.value.trim().replace(/\s+/g, '');
  const destinationPhoneClean = s_destinationPhone.value.trim().replace(/\s+/g, '');
  const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;

  if (!regex.test(senderPhoneClean)) {
    alert('Numéro expéditeur invalide ! Format : 00224XXXXXXXXX ou 00336/00337XXXXXXXX');
    return;
  }

  if (!regex.test(destinationPhoneClean)) {
    alert('Numéro destinataire invalide ! Format : 00224XXXXXXXXX ou 00336/00337XXXXXXXX');
    return;
  }

  postData('/stock/new', {
    _id: currentStockId,
    sender: s_sender.value,
    senderPhone: senderPhoneClean,
    destination: s_destination.value,
    destinationPhone: destinationPhoneClean,
    amount: parseFloat(s_amount.value),
    currency: s_currency.value,
  }).then((res) => {
    if (res.success) location.reload();
    else alert(res.error || 'Erreur serveur');
  });
}


function deleteStock(id) {
  if (confirm('Supprimer ?'))
    postData('/stock/delete', { id }).then(() => location.reload()); // <-- ici
}

/* ================= CLIENT ================= */
function openClientModal(id = null) {
  currentClientId = id;
  //clientModal.style.display = 'flex';
  document.getElementById('clientModal').style.display = 'none';
  
  

  if (!id) {
    c_firstName.value = '';
    c_lastName.value = '';
    c_phone.value = '';
    c_email.value = '';
    c_kyc.value = 'false';
    return;
  }

  fetch('/client/' + id)
    .then(r => r.json())
    .then(c => {
      c_firstName.value = c.firstName || '';
      c_lastName.value = c.lastName || '';
      c_phone.value = c.phone || '';
      c_email.value = c.email || '';
      c_kyc.value = c.kycVerified ? 'true' : 'false';
    });
}

function closeClientModal(){
  clientModal.style.display='none';
  currentClientId=null;
}

function deleteClient(id){
  if(confirm('Supprimer ?'))
    postData('/client/delete',{id}).then(()=>location.reload());
}

/* ================= RATE ================= */
function openRateModal(id = null) {
  currentRateId = id;
  document.getElementById('rateModal').style.display = 'flex';

  if (!id) {
    r_from.value = '';
    r_to.value = '';
    r_rate.value = '';
    return;
  }

  fetch('/rate/' + id)
    .then(r => r.json())
    .then(rate => {
      r_from.value = rate.from || '';
      r_to.value = rate.to || '';
      r_rate.value = rate.rate || '';
    });
}


function closeRateModal(){
  document.getElementById('rateModal').style.display = 'none';
  currentRateId=null;
}
function saveRate(){
  postData('/rate/new',{
    _id:currentRateId,
    from:r_from.value,
    to:r_to.value,
    rate:parseFloat(r_rate.value)
  }).then(()=>location.reload());
}
function deleteRate(id){
  if(confirm('Supprimer ?'))
    postData('/rate/delete',{id}).then(()=>location.reload());
}

/* Export */
function exportPDF(){window.open('/export/pdf','_blank');}
function exportExcel(){window.open('/export/excel','_blank');}

</script>
</html>
`;

  
  res.send(html);
});

// ================= CRUD TRANSFERT =================
// Obtenir un transfert par ID
app.get('/transfert/:id', requireLogin, async (req, res) => {
  try {
    const t = await Transfert.findById(req.params.id);
    res.json(t);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Créer ou mettre à jour un transfert
app.post('/transfert/new', requireLogin, async (req, res) => {
  try {
    const data = req.body;

    // 🔹 Validation des numéros de téléphone
    function isValidPhone(phone) {
      if (!phone) return false;
      phone = phone.toString().trim().replace(/\s+/g, '');
      // Guinée : 00224XXXXXXXXX (9 chiffres après 00224)
      // France : 00336XXXXXXXX ou 00337XXXXXXXX (9 chiffres après 00336/00337)
      const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;
      return regex.test(phone);
    }

    if (
      (data.senderPhone && !isValidPhone(data.senderPhone)) ||
      (data.receiverPhone && !isValidPhone(data.receiverPhone))
    ) {
      return res.status(400).json({
        error: 'Numéro invalide. Format requis : 00224XXXXXXXXX (Guinée) ou 00336/00337XXXXXXXX (France)'
      });
    }

    // 🔹 Création ou mise à jour
    if (data._id) {
      await Transfert.findByIdAndUpdate(data._id, data, { new: true });
    } else {
      data.code = await generateUniqueCode();
      data.userType = 'Client';
      data.received = (parseFloat(data.amount) || 0) - (parseFloat(data.fees) || 0);
      await new Transfert(data).save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur saveTransfert:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Supprimer un transfert
app.post('/transfert/delete', requireLogin, async (req, res) => {
  try {
    await Transfert.findByIdAndDelete(req.body.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Marquer un transfert comme retiré
app.post('/transfert/retirer', requireLogin, async (req, res) => {

  if (!req.session.user.permissions.retrait) {
    return res.status(403).json({ error: 'Droit retrait interdit' });
  }

  try {
    console.log('BODY:', req.body);

    const { id, mode } = req.body;
    if (!id) return res.status(400).json({ error: 'ID manquant' });

    const t = await Transfert.findById(id);
    if (!t) return res.status(404).json({ error: 'Transfert introuvable' });
    if (t.retired) return res.status(400).json({ error: 'Déjà retiré' });

    const montantRetire = t.amount - t.fees;

    const stock = await StockHistory.findOne({
      destination: t.destinationLocation,
      currency: t.currency
    });

    if (!stock) {
      console.log('AUCUN STOCK POUR', t.destinationLocation, t.currency);
      return res.status(400).json({ error: 'Stock introuvable' });
    }

    if (stock.amount < montantRetire) {
      return res.status(400).json({ error: 'Stock insuffisant' });
    }

    stock.amount -= montantRetire;
    await stock.save();

    t.retired = true;
    t.retraitHistory.push({
      date: new Date(),
      mode: mode || 'ESPECE'
    });
    await t.save();

    res.json({ success: true });

  } catch (err) {
    console.error('ERREUR RETRAIT:', err);
    res.status(500).json({ error: err.message });
  }

});


// ================= CRUD STOCK =================
// Obtenir un stock par ID
app.get('/stock/:id', requireLogin, async (req, res) => {
  try {
    const stock = await StockHistory.findById(req.params.id);
    res.json(stock);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/rate/:id', requireLogin, async (req, res) => {
  try {
    const rate = await Rate.findById(req.params.id);
    if (!rate) return res.status(404).json({ error: 'Rate introuvable' });
    res.json(rate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Obtenir un client par ID
app.get('/client/:id', requireLogin, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Créer ou mettre à jour un stock

/* CREATE / UPDATE */
app.post('/stock/new', requireLogin, async (req, res) => {
  try {
    const data = req.body;

    // 🔹 Validation téléphone
    function isValidPhone(phone) {
      if (!phone) return false;
      phone = phone.toString().trim().replace(/\s+/g, '');
	  const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;


      return regex.test(phone);
    }

    if (
      (data.senderPhone && !isValidPhone(data.senderPhone)) ||
      (data.destinationPhone && !isValidPhone(data.destinationPhone))
    ) {
      return res.status(400).json({
        error: 'Numéro invalide. Format requis : 00224XXXXXXXXX (Guinée) ou 00336/00337XXXXXXXX (France)'
      });
    }

    let stock;
    if (data._id) {
      stock = await StockHistory.findByIdAndUpdate(data._id, data, { new: true });
      await StockHistory.create({
        action: 'MODIFICATION',
        stockId: stock._id,
        ...stock.toObject(),
      });
    } else {
      data.code = await generateUniqueCode();
      stock = await new StockHistory(data).save();
      // StockHistory.create({action:'CREATION', stockId:stock._id, ...stock.toObject()});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur saveStock:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});



// Supprimer un stock
app.post('/stock/delete', requireLogin, async (req, res) => {
  try {
    await StockHistory.findByIdAndDelete(req.body.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ================= CRUD CLIENT =================
// Créer ou mettre à jour un client
app.post('/client/new', requireLogin, async (req, res) => {
  try {
    const data = req.body;

    // 🔹 Validation téléphone
    function isValidPhone(phone) {
      if (!phone) return false;
      phone = phone.toString().trim().replace(/\s+/g, '');
      const regex = /^(00224\d{9}|00336\d{9}|00337\d{9})$/;
      return regex.test(phone);
    }

    if (data.phone && !isValidPhone(data.phone)) {
      return res.status(400).json({
        error: 'Numéro invalide. Format requis : 00224XXXXXXXXX (Guinée) ou 00336/00337XXXXXXXX (France)'
      });
    }

    if (data._id) {
      await Client.findByIdAndUpdate(data._id, data, { new: true });
    } else {
      await new Client(data).save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur saveClient:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Supprimer un client
app.post('/client/delete', requireLogin, async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.body.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ================= CRUD RATE =================
// Créer ou mettre à jour un taux
app.post('/rate/new', requireLogin, async (req, res) => {
  try {
    if (req.body._id) {
      await Rate.findByIdAndUpdate(req.body._id, req.body, { new: true });
    } else {
      await new Rate(req.body).save();
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Supprimer un taux
app.post('/rate/delete', requireLogin, async (req, res) => {
  try {
    await Rate.findByIdAndDelete(req.body.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ================== IMPRIMER TRANSFERT ==================
app.get('/transfert/print/:id', requireLogin, async (req, res) => {
  try {
    const t = await Transfert.findById(req.params.id);
    if (!t) return res.status(404).send('Transfert introuvable');

    // Envoi du HTML avec variables interpolées
    res.send(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Transfert ${t.code}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h2 { color: #ff8c42; }
          p { margin: 5px 0; }
        </style>
      </head>
      <body>
        <h2>Transfert ${t.code}</h2>
        <p><strong>Expéditeur :</strong> ${t.senderFirstName} ${t.senderLastName} 📞 ${t.senderPhone || '-'}</p>
        <p><strong>Origine :</strong> ${t.originLocation}</p>
        <p><strong>Destinataire :</strong> ${t.receiverFirstName} ${t.receiverLastName} 📞 ${t.receiverPhone || '-'}</p>
        <p><strong>Destination :</strong> ${t.destinationLocation}</p>
        <p><strong>Montant :</strong> ${t.amount} ${t.currency}</p>
        <p><strong>Frais :</strong> ${t.fees}</p>
        <p><strong>Reçu :</strong> ${t.received}</p>
        <p><strong>Status :</strong> ${t.retired ? 'Retiré' : 'Non retiré'}</p>

        <script>
          window.onload = function() {
            window.print(); // Lancer l'impression automatiquement
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Erreur impression transfert:', err);
    res.status(500).send('Erreur serveur');
  }
});



// ================= EXPORT =================
app.get('/export/pdf',requireLogin,async(req,res)=>{const doc=new PDFDocument();res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename=export.pdf');doc.text('Liste des transferts\n\n');const transferts=await Transfert.find().sort({createdAt:-1});transferts.forEach(t=>doc.text(`Code: ${t.code} - Exp: ${t.senderFirstName} - Dest: ${t.receiverFirstName} - Montant: ${t.amount} ${t.currency}`));doc.pipe(res);doc.end();});

app.get('/export/excel',requireLogin,async(req,res)=>{const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Transferts');sheet.columns=[{header:'Code',key:'code',width:10},{header:'Expéditeur',key:'sender',width:20},{header:'Destinataire',key:'receiver',width:20},{header:'Montant',key:'amount',width:10},{header:'Frais',key:'fees',width:10},{header:'Reçu',key:'received',width:10},{header:'Devise',key:'currency',width:10},{header:'Status',key:'status',width:10}];const transferts=await Transfert.find();transferts.forEach(t=>sheet.addRow({code:t.code,sender:t.senderFirstName,receiver:t.receiverFirstName,amount:t.amount,fees:t.fees,received:t.received,currency:t.currency,status:t.retired?'Retiré':'Non retiré'}));res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');await workbook.xlsx.write(res);res.end();});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur le port '+PORT));
