/******************************************************************
 * APP TRANSFERT + STOCKS + CLIENTS + RATES + EXPORT + HISTORY
 * COMPLET : Dashboard avec modals CRUD et design existant
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
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

/* ================= DATABASE ================= */
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
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
  received: Number,
  currency: { type: String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: { type: String, default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const clientSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  phone: String,
  email: String,
  kycVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({
  from: String,
  to: String,
  rate: Number,
  createdAt: { type: Date, default: Date.now }
});
const Rate = mongoose.model('Rate', rateSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

function setPermissions(username){
  if(username === 'a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username === 'admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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
    const {username,password} = req.body;
    let user = await Auth.findOne({username});
    if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user={ username:user.username, role:user.role, permissions:setPermissions(username) };
    res.redirect('/dashboard');
  }catch(err){ console.error(err); res.status(500).send('Erreur login'); }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async(req,res)=>{
  const q = req.query;
  const filters = {};

  if(q.code) filters.code = { $regex:q.code, $options:'i' };
  if(q.sender) filters.senderFirstName = { $regex:q.sender, $options:'i' };
  if(q.receiver) filters.receiverFirstName = { $regex:q.receiver, $options:'i' };
  if(q.currency) filters.currency = q.currency;
  if(q.status!==''){ filters.retired = q.status==='true'; }
  if(q.dateFrom||q.dateTo){ filters.createdAt={}; if(q.dateFrom) filters.createdAt.$gte=new Date(q.dateFrom); if(q.dateTo) filters.createdAt.$lte=new Date(q.dateTo+'T23:59:59'); }

  const transferts = await Transfert.find(filters).sort({ createdAt:-1 });
  const stocks = await Stock.find().sort({ createdAt:-1 });
  const clients = await Client.find().sort({ createdAt:-1 });
  const rates = await Rate.find().sort({ createdAt:-1 });

  const p = req.session.user.permissions;

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
  h2,h3{margin-top:20px;color:#333;}
  table{border-collapse:collapse;width:100%;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;font-size:12px;}
  th{background:#ff8c42;color:white;}
  button{margin:2px;padding:3px 6px;cursor:pointer;}
  .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
  .modal-content{background:white;padding:20px;border-radius:10px;max-width:500px;width:90%;overflow:auto;}
  input,select{width:100%;padding:6px;margin-bottom:10px;}
  </style></head><body>
  <h2>📊 Dashboard</h2>
  <a href="/logout">🚪 Déconnexion</a>
  <button onclick="exportPDF()">📄 Export PDF</button>
  <button onclick="exportExcel()">📊 Export Excel</button>

  <!-- RECHERCHE -->
  <h4>Recherche Transfert</h4>
  <input id="f_code" placeholder="Code"><input id="f_sender" placeholder="Expéditeur"><input id="f_receiver" placeholder="Destinataire">
  <input id="f_currency" placeholder="Devise"><select id="f_status"><option value="">Tous</option><option value="true">Retiré</option><option value="false">Non retiré</option></select>
  <input type="date" id="f_date_from"> à <input type="date" id="f_date_to">
  <button onclick="searchTransferts()">🔎 Rechercher</button>
  `;

// =================== Transferts ===================
html+=`<h3>Transferts</h3>`;
if(p.ecriture) html+=`<button onclick="openTransfertModal()">➕ Nouveau Transfert</button>`;
html+=`<table>
<tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Mode</th><th>Status</th><th>Actions</th></tr>`;
transferts.forEach(t=>{
html+=`<tr>
<td>${t.code}</td>
<td>${t.originLocation}</td>
<td>${t.senderFirstName} ${t.senderLastName} 📞${t.senderPhone||'-'}</td>
<td>${t.destinationLocation}</td>
<td>${t.receiverFirstName} ${t.receiverLastName} 📞${t.receiverPhone||'-'}</td>
<td>${t.amount}</td><td>${t.fees}</td><td>${t.received}</td><td>${t.currency}</td><td>${t.recoveryMode}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
${p.modification?`<button onclick="openTransfertModal('${t._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteTransfert('${t._id}')">❌</button>`:''}
${(!t.retired && p.retrait)?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
${p.imprimer?`<button onclick="window.open('/transfert/print/${t._id}','_blank')">🖨</button>`:''}
</td></tr>`;
});
html+=`</table>`;

// =================== Stocks ===================
html+=`<h3>Stocks</h3>`;
if(p.ecriture) html+=`<button onclick="openStockModal()">➕ Nouveau Stock</button>`;
html+=`<table>
<tr><th>Code</th><th>Expéditeur</th><th>Téléphone</th><th>Destination</th><th>Téléphone</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
stocks.forEach(s=>{
html+=`<tr>
<td>${s.code}</td><td>${s.sender}</td><td>${s.senderPhone||'-'}</td><td>${s.destination}</td><td>${s.destinationPhone||'-'}</td>
<td>${s.amount}</td><td>${s.currency}</td>
<td>
${p.modification?`<button onclick="openStockModal('${s._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteStock('${s._id}')">❌</button>`:''}
</td></tr>`;
});
html+=`</table>`;

// =================== Clients ===================
html+=`<h3>Clients KYC</h3>`;
if(p.ecriture) html+=`<button onclick="openClientModal()">➕ Nouveau Client</button>`;
html+=`<table>
<tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr>`;
clients.forEach(c=>{
html+=`<tr>
<td>${c.lastName}</td><td>${c.firstName}</td><td>${c.phone}</td><td>${c.email||'-'}</td><td>${c.kycVerified?'✅':'❌'}</td>
<td>
${p.modification?`<button onclick="openClientModal('${c._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteClient('${c._id}')">❌</button>`:''}
</td></tr>`;
});
html+=`</table>`;

// =================== Taux ===================
html+=`<h3>Taux de Change</h3>`;
if(p.ecriture) html+=`<button onclick="openRateModal()">➕ Nouveau Taux</button>`;
html+=`<table>
<tr><th>De</th><th>Vers</th><th>Rate</th><th>Actions</th></tr>`;
rates.forEach(r=>{
html+=`<tr>
<td>${r.from}</td><td>${r.to}</td><td>${r.rate}</td>
<td>
${p.modification?`<button onclick="openRateModal('${r._id}')">✏️</button>`:''}
${p.suppression?`<button onclick="deleteRate('${r._id}')">❌</button>`:''}
</td></tr>`;
});
html+=`</table>`;

// =================== MODALS & SCRIPT ===================
html+=`
<div id="transfertModal" class="modal">
<div class="modal-content">
<h3>Transfert</h3>
<input id="t_code" readonly placeholder="Code">
<input id="t_origin" placeholder="Origine">
<input id="t_sender" placeholder="Nom expéditeur">
<input id="t_senderPhone" placeholder="Téléphone expéditeur">
<input id="t_destination" placeholder="Destination">
<input id="t_receiver" placeholder="Nom destinataire">
<input id="t_receiverPhone" placeholder="Téléphone destinataire">
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
<input id="s_senderPhone" placeholder="Téléphone expéditeur">
<input id="s_destination" placeholder="Destination">
<input id="s_destinationPhone" placeholder="Téléphone destination">
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
<input id="c_phone" placeholder="Téléphone">
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
let currentTransfertId=null, currentStockId=null, currentClientId=null, currentRateId=null;
function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
function searchTransferts(){
  const params=new URLSearchParams({code:f_code.value,sender:f_sender.value,receiver:f_receiver.value,currency:f_currency.value,status:f_status.value,dateFrom:f_date_from.value,dateTo:f_date_to.value});
  window.location.href='/dashboard?'+params.toString();
}
// MODALS FUNCTIONS
function openTransfertModal(id=null){currentTransfertId=id;transfertModal.style.display='flex'; if(!id){t_code.value=t_origin.value=t_sender.value=t_senderPhone.value=t_destination.value=t_receiver.value=t_receiverPhone.value=t_amount.value=t_fees.value=t_received.value='';return;} fetch('/transfert/'+id).then(r=>r.json()).then(d=>{t_code.value=d.code;t_origin.value=d.originLocation;t_sender.value=d.senderFirstName;t_senderPhone.value=d.senderPhone;t_destination.value=d.destinationLocation;t_receiver.value=d.receiverFirstName;t_receiverPhone.value=d.receiverPhone;t_amount.value=d.amount;t_fees.value=d.fees;t_received.value=d.received;t_currency.value=d.currency;t_recoveryMode.value=d.recoveryMode;});}
function closeTransfertModal(){transfertModal.style.display='none'; currentTransfertId=null;}
function saveTransfert(){ const data={originLocation:t_origin.value,senderFirstName:t_sender.value,senderPhone:t_senderPhone.value,destinationLocation:t_destination.value,receiverFirstName:t_receiver.value,receiverPhone:t_receiverPhone.value,amount:parseFloat(t_amount.value),fees:parseFloat(t_fees.value),received:parseFloat(t_received.value),currency:t_currency.value,recoveryMode:t_recoveryMode.value}; postData(currentTransfertId?'/transfert/update/'+currentTransfertId:'/transfert/create',data).then(()=>location.reload());}
function retirerTransfert(id){postData('/transfert/retirer/'+id,{}).then(()=>location.reload());}
function deleteTransfert(id){postData('/transfert/delete/'+id,{}).then(()=>location.reload());}

// STOCK
function openStockModal(id=null){currentStockId=id;stockModal.style.display='flex'; if(!id){s_code.value=s_sender.value=s_senderPhone.value=s_destination.value=s_destinationPhone.value=s_amount.value='';return;} fetch('/stock/'+id).then(r=>r.json()).then(d=>{s_code.value=d.code;s_sender.value=d.sender;s_senderPhone.value=d.senderPhone;s_destination.value=d.destination;s_destinationPhone.value=d.destinationPhone;s_amount.value=d.amount;s_currency.value=d.currency;});}
function closeStockModal(){stockModal.style.display='none'; currentStockId=null;}
function saveStock(){ const data={sender:s_sender.value,senderPhone:s_senderPhone.value,destination:s_destination.value,destinationPhone:s_destinationPhone.value,amount:parseFloat(s_amount.value),currency:s_currency.value}; postData(currentStockId?'/stock/update/'+currentStockId:'/stock/create',data).then(()=>location.reload());}
function deleteStock(id){postData('/stock/delete/'+id,{}).then(()=>location.reload());}

// CLIENT
function openClientModal(id=null){currentClientId=id;clientModal.style.display='flex'; if(!id){c_firstName.value=c_lastName.value=c_phone.value=c_email.value=c_kyc.value='false';return;} fetch('/client/'+id).then(r=>r.json()).then(d=>{c_firstName.value=d.firstName;c_lastName.value=d.lastName;c_phone.value=d.phone;c_email.value=d.email;c_kyc.value=d.kycVerified;});}
function closeClientModal(){clientModal.style.display='none'; currentClientId=null;}
function saveClient(){ const data={firstName:c_firstName.value,lastName:c_lastName.value,phone:c_phone.value,email:c_email.value,kycVerified:c_kyc.value==='true'}; postData(currentClientId?'/client/update/'+currentClientId:'/client/create',data).then(()=>location.reload());}
function deleteClient(id){postData('/client/delete/'+id,{}).then(()=>location.reload());}

// RATE
function openRateModal(id=null){currentRateId=id;rateModal.style.display='flex'; if(!id){r_from.value=r_to.value=r_rate.value='';return;} fetch('/rate/'+id).then(r=>r.json()).then(d=>{r_from.value=d.from;r_to.value=d.to;r_rate.value=d.rate;});}
function closeRateModal(){rateModal.style.display='none'; currentRateId=null;}
function saveRate(){ const data={from:r_from.value,to:r_to.value,rate:parseFloat(r_rate.value)}; postData(currentRateId?'/rate/update/'+currentRateId:'/rate/create',data).then(()=>location.reload());}
function deleteRate(id){postData('/rate/delete/'+id,{}).then(()=>location.reload());}

// EXPORTS
function exportPDF(){window.open('/export/pdf','_blank');}
function exportExcel(){window.open('/export/excel','_blank');}
</script>
`;

html+=`</body></html>`;
res.send(html);
});

/* ================= SERVER ================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur le port '+PORT));
