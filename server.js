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
app.use(session({ secret: process.env.SESSION_SECRET || 'transfert-secret-final', resave: false, saveUninitialized: true }));

// ================= DATABASE =================
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

// ================= SCHEMAS =================
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

const stockHistorySchema = new mongoose.Schema({
  code: String,
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: String,
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

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

// ================= UTILS =================
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
  if(username==='a') return { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true };
  if(username==='admin2') return { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true };
  return { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true };
}
function isValidPhone(phone){return /^00224\d{9}$/.test(phone)||/^0033\d{9}$/.test(phone);}
function normalizeUpper(v){return (v||'').toString().trim().toUpperCase();}

// ================= LOGIN =================
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
    const {username,password} = req.body;
    let user = await Auth.findOne({username});
    if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user={ username:user.username, role:user.role, permissions:setPermissions(username) };
    res.redirect('/dashboard');
  }catch(err){ console.error(err); res.status(500).send('Erreur lors de la connexion'); }
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const stockHistory = await StockHistory.find().sort({date:-1});
  const clients = await Client.find().sort({createdAt:-1});
  const rates = await Rate.find().sort({createdAt:-1});

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
  h2,h3,h4{margin-top:20px;color:#333;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}a:hover{text-decoration:underline;}
  table{border-collapse:collapse;width:100%;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:8px;}
  th{background:#ff8c42;color:white;}
  button{margin:2px;padding:5px 10px;cursor:pointer;}
  .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
  .modal-content{background:white;padding:20px;border-radius:10px;max-width:500px;width:90%;overflow:auto;}
  input,select{width:100%;padding:6px;margin-bottom:10px;}
  </style></head><body>
  <h2>📊 Dashboard</h2>
  <a href="/logout">🚪 Déconnexion</a>
  <button onclick="exportPDF()">📄 Export PDF</button>
  <button onclick="exportExcel()">📊 Export Excel</button>`;

  // =================== Transferts Table ===================
  html+=`<h3>Transferts</h3>
  <button onclick="openTransfertModal()">➕ Nouveau Transfert</button>
  <table>
  <tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
  transferts.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.originLocation}</td>
      <td>${t.senderFirstName} 📞 ${t.senderPhone||'-'}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.receiverFirstName} 📞 ${t.receiverPhone||'-'}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.received}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <button onclick="openTransfertModal('${t._id}')">✏️</button>
        <button onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
      </td>
    </tr>`;
  });
  html+=`</table>`;

  // =================== Stocks Table ===================
  html+=`<h3>Stocks</h3><button onclick="openStockModal()">➕ Nouveau Stock</button>
  <table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{
    html+=`<tr>
      <td>${s.code}</td>
      <td>${s.sender} 📞 ${s.senderPhone||'-'}</td>
      <td>${s.destination} 📞 ${s.destinationPhone||'-'}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
        <button onclick="openStockModal('${s._id}')">✏️</button>
        <button onclick="deleteStock('${s._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table>`;

  // =================== Stock History Table ===================
  html+=`<h3>Historique Stocks</h3>
  <table><tr><th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr>`;
  stockHistory.forEach(h=>{
    html+=`<tr>
      <td>${new Date(h.date).toLocaleString()}</td>
      <td>${h.code}</td>
      <td>${h.sender} 📞 ${h.senderPhone||'-'}</td>
      <td>${h.destination} 📞 ${h.destinationPhone||'-'}</td>
      <td>${h.amount}</td>
      <td>${h.currency}</td>
    </tr>`;
  });
  html+=`</table>`;

  // =================== Clients KYC ===================
  html+=`<h3>Clients KYC</h3><button onclick="openClientModal()">➕ Nouveau Client</button>
  <table><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr>`;
  clients.forEach(c=>{
    html+=`<tr>
      <td>${c.lastName}</td>
      <td>${c.firstName}</td>
      <td>${c.phone}</td>
      <td>${c.email||'-'}</td>
      <td>${c.kycVerified?'✅':'❌'}</td>
      <td><button onclick="openClientModal('${c._id}')">✏️</button><button onclick="deleteClient('${c._id}')">❌</button></td>
    </tr>`;
  });
  html+=`</table>`;

  // =================== Taux / Rates ===================
  html+=`<h3>Taux de Change</h3><button onclick="openRateModal()">➕ Nouveau Taux</button>
  <table><tr><th>De</th><th>Vers</th><th>Rate</th><th>Actions</th></tr>`;
  rates.forEach(r=>{
    html+=`<tr>
      <td>${r.from}</td><td>${r.to}</td><td>${r.rate}</td>
      <td><button onclick="openRateModal('${r._id}')">✏️</button><button onclick="deleteRate('${r._id}')">❌</button></td>
    </tr>`;
  });
  html+=`</table>`;

  // =================== MODALS ===================
  html+=`
<div id="transfertModal" class="modal">
<div class="modal-content">
<h3>Transfert</h3>
<input id="t_code" readonly placeholder="Code généré">
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
<input id="s_code" readonly placeholder="Code généré">
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
</div></div>`;

  // =================== SCRIPT ===================
  html+=`<script>
let currentTransfertId=null, currentStockId=null, currentClientId=null, currentRateId=null;

function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

function openTransfertModal(id=null){currentTransfertId=id;document.getElementById('transfertModal').style.display='flex';}
function closeTransfertModal(){document.getElementById('transfertModal').style.display='none';currentTransfertId=null;}
function saveTransfert(){const t={_id:currentTransfertId,originLocation:document.getElementById('t_origin').value,senderFirstName:document.getElementById('t_sender').value,senderPhone:document.getElementById('t_senderPhone').value,destinationLocation:document.getElementById('t_destination').value,receiverFirstName:document.getElementById('t_receiver').value,receiverPhone:document.getElementById('t_receiverPhone').value,amount:parseFloat(document.getElementById('t_amount').value),fees:parseFloat(document.getElementById('t_fees').value),received:parseFloat(document.getElementById('t_amount').value)-parseFloat(document.getElementById('t_fees').value),currency:document.getElementById('t_currency').value,recoveryMode:document.getElementById('t_recoveryMode').value};postData('/transfert/save',t).then(()=>location.reload());}

function deleteTransfert(id){if(confirm('Supprimer ?')) postData('/transfert/delete',{id}).then(()=>location.reload());}
function retirerTransfert(id){if(confirm('Retirer ce transfert ?')){postData('/transfert/save',{_id:id,retired:true}).then(()=>location.reload());}}

function openStockModal(id=null){currentStockId=id;document.getElementById('stockModal').style.display='flex';}
function closeStockModal(){document.getElementById('stockModal').style.display='none';currentStockId=null;}
function saveStock(){const s={_id:currentStockId,sender:document.getElementById('s_sender').value,senderPhone:document.getElementById('s_senderPhone').value,destination:document.getElementById('s_destination').value,destinationPhone:document.getElementById('s_destinationPhone').value,amount:parseFloat(document.getElementById('s_amount').value),currency:document.getElementById('s_currency').value};postData('/stock/save',s).then(()=>location.reload());}
function deleteStock(id){if(confirm('Supprimer ?')) postData('/stock/delete',{id}).then(()=>location.reload());}

function openClientModal(id=null){currentClientId=id;document.getElementById('clientModal').style.display='flex';}
function closeClientModal(){document.getElementById('clientModal').style.display='none';currentClientId=null;}
function saveClient(){const c={_id:currentClientId,firstName:document.getElementById('c_firstName').value,lastName:document.getElementById('c_lastName').value,phone:document.getElementById('c_phone').value,email:document.getElementById('c_email').value,kycVerified:document.getElementById('c_kyc').value==='true'};postData('/client/save',c).then(()=>location.reload());}
function deleteClient(id){if(confirm('Supprimer ?')) postData('/client/delete',{id}).then(()=>location.reload());}

function openRateModal(id=null){currentRateId=id;document.getElementById('rateModal').style.display='flex';}
function closeRateModal(){document.getElementById('rateModal').style.display='none';currentRateId=null;}
function saveRate(){const r={_id:currentRateId,from:document.getElementById('r_from').value,to:document.getElementById('r_to').value,rate:parseFloat(document.getElementById('r_rate').value)};postData('/rate/save',r).then(()=>location.reload());}
function deleteRate(id){if(confirm('Supprimer ?')) postData('/rate/delete',{id}).then(()=>location.reload());}

function exportPDF(){window.open('/export/pdf','_blank');}
function exportExcel(){window.open('/export/excel','_blank');}
</script>`;

  html+=`</body></html>`;
  res.send(html);
});

// ================= CRUD TRANSFERT/STOCK/CLIENT/RATE =================
// Code similaire à l’exemple précédent (post '/transfert/save', delete etc.)

// ================= EXPORT PDF / EXCEL =================
app.get('/export/pdf', requireLogin, async(req,res)=>{
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename=export.pdf');
  doc.text('Liste des transferts\n\n');
  const transferts = await Transfert.find().sort({createdAt:-1});
  transferts.forEach(t=>doc.text(`Code: ${t.code} - Exp: ${t.senderFirstName} - Dest: ${t.receiverFirstName} - Montant: ${t.amount} ${t.currency}`));
  doc.end();
  doc.pipe(res);
});

app.get('/export/excel', requireLogin, async(req,res)=>{
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code', key:'code', width:10},
    {header:'Expéditeur', key:'sender', width:20},
    {header:'Destinataire', key:'receiver', width:20},
    {header:'Montant', key:'amount', width:10},
    {header:'Frais', key:'fees', width:10},
    {header:'Reçu', key:'received', width:10},
    {header:'Devise', key:'currency', width:10},
    {header:'Status', key:'status', width:10},
  ];
  const transferts = await Transfert.find();
  transferts.forEach(t=>sheet.addRow({
    code:t.code, sender:t.senderFirstName, receiver:t.receiverFirstName,
    amount:t.amount, fees:t.fees, received:t.received, currency:t.currency,
    status:t.retired?'Retiré':'Non retiré'
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});


// ================== CRUD Routes ==================
app.post('/transfert/new', async(req,res)=>{ const data=req.body; if(data._id) await Transfert.findByIdAndUpdate(data._id,data,{new:true}); else{ data.code=await generateUniqueCode(); await new Transfert(data).save(); } res.json({success:true}); });
app.post('/transfert/delete', async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.post('/transfert/retirer', async(req,res)=>{ const t=await Transfert.findById(req.body.id); if(t){ t.retired=true; t.retraitHistory.push({date:new Date(),mode:req.body.mode}); await t.save(); } res.json({success:true}); });

// Idem pour stock
app.post('/stock/new', async(req,res)=>{ if(req.body._id) await Stock.findByIdAndUpdate(req.body._id,req.body,{new:true}); else{ req.body.code=await generateUniqueCode(); await new Stock(req.body).save(); } res.json({success:true}); });
app.post('/stock/delete', async(req,res)=>{ await Stock.findByIdAndDelete(req.body.id); res.json({success:true}); });

// Client
app.post('/client/new', async(req,res)=>{ if(req.body._id) await Client.findByIdAndUpdate(req.body._id,req.body,{new:true}); else await new Client(req.body).save(); res.json({success:true}); });
app.post('/client/delete', async(req,res)=>{ await Client.findByIdAndDelete(req.body.id); res.json({success:true}); });

// Rate
app.post('/rate/new', async(req,res)=>{ if(req.body._id) await Rate.findByIdAndUpdate(req.body._id,req.body,{new:true}); else await new Rate(req.body).save(); res.json({success:true}); });
app.post('/rate/delete', async(req,res)=>{ await Rate.findByIdAndDelete(req.body.id); res.json({success:true}); });





/******************** SERVER *************************/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Serveur lancé sur le port ' + PORT);
});
