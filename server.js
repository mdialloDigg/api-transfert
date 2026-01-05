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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
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

const stockHistorySchema = new mongoose.Schema({
  code: String,
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  balance: Number,
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

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists = true;
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
  if(username === 'a') return { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true };
  if(username === 'admin2') return { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true };
  return { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true };
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%; padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
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

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async(req,res)=>{
  const q = req.query;
  const filters = {};

  if (q.code) filters.code = q.code.toUpperCase();
  if (q.currency) filters.currency = q.currency;
  if (q.status !== undefined && q.status !== '') filters.retired = q.status === 'true';
  if (q.sender) filters.senderFirstName = { $regex:q.sender, $options:'i' };
  if (q.receiver) filters.receiverFirstName = { $regex:q.receiver, $options:'i' };
  if (q.dateFrom || q.dateTo){
    filters.createdAt = {};
    if(q.dateFrom) filters.createdAt.$gte = new Date(q.dateFrom);
    if(q.dateTo) filters.createdAt.$lte = new Date(q.dateTo+'T23:59:59');
  }

  const transferts = await Transfert.find(filters).sort({ createdAt:-1 });
  const stocks = await Stock.find().sort({ createdAt:-1 });
  const stockHistory = await StockHistory.find().sort({ date:-1 });
  const clients = await Client.find().sort({ createdAt:-1 });
  const rates = await Rate.find().sort({ createdAt:-1 });
  const p = req.session.user.permissions;

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
  h2,h3,h4{margin-top:20px;color:#333;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}
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

  /* ------------------ TRANSFERTS ------------------ */
  html+=`<h3>Transferts</h3>${p.ecriture?'<button onclick="openTransfertModal()">➕ Nouveau Transfert</button>':''}
  <table><tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destinataire</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Mode</th><th>Status</th><th>Actions</th></tr>`;
  transferts.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.originLocation}</td>
      <td>${t.senderFirstName} ${t.senderLastName} 📞 ${t.senderPhone||'-'}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} 📞 ${t.receiverPhone||'-'}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.received}</td>
      <td>${t.currency}</td>
      <td>${t.recoveryMode||'-'}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        ${p.modification?`<button onclick="openTransfertModal('${t._id}')">✏️</button>`:''}
        ${p.suppression?`<button onclick="deleteTransfert('${t._id}')">❌</button>`:''}
        ${(!t.retired && p.retrait)?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
        ${p.imprimer?`<button onclick="window.open('/transfert/print/${t._id}','_blank')">🖨</button>`:''}
      </td>
    </tr>`;
  });
  html+='</table>';

  /* ------------------ STOCKS ------------------ */
  html+=`<h3>Stocks</h3>${p.ecriture?'<button onclick="openStockModal()">➕ Nouveau Stock</button>':''}
  <table><tr><th>Code</th><th>Expéditeur</th><th>Téléphone</th><th>Destination</th><th>Téléphone</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
  stockHistory.forEach(s=>{
    html+=`<tr>
      <td>${s.code}</td>
      <td>${s.sender}</td>
      <td>${s.senderPhone||'-'}</td>
      <td>${s.destination}</td>
      <td>${s.destinationPhone||'-'}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
        ${p.modification?`<button onclick="openStockModal('${s._id}')">✏️</button>`:''}
        ${p.suppression?`<button onclick="deleteStock('${s._id}')">❌</button>`:''}
      </td>
    </tr>`;
  });
  html+='</table>';

  /* ------------------ CLIENTS ------------------ */
  html+=`<h3>Clients KYC</h3>${p.ecriture?'<button onclick="openClientModal()">➕ Nouveau Client</button>':''}
  <table><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr>`;
  clients.forEach(c=>{
    html+=`<tr>
      <td>${c.lastName}</td><td>${c.firstName}</td><td>${c.phone}</td><td>${c.email||'-'}</td>
      <td>${c.kycVerified?'✅':'❌'}</td>
      <td>
        ${p.modification?`<button onclick="openClientModal('${c._id}')">✏️</button>`:''}
        ${p.suppression?`<button onclick="deleteClient('${c._id}')">❌</button>`:''}
      </td>
    </tr>`;
  });
  html+='</table>';

  /* ------------------ RATES ------------------ */
  html+=`<h3>Taux de change</h3>${p.ecriture?'<button onclick="openRateModal()">➕ Nouveau Taux</button>':''}
  <table><tr><th>De</th><th>Vers</th><th>Rate</th><th>Actions</th></tr>`;
  rates.forEach(r=>{
    html+=`<tr>
      <td>${r.from}</td><td>${r.to}</td><td>${r.rate}</td>
      <td>
        ${p.modification?`<button onclick="openRateModal('${r._id}')">✏️</button>`:''}
        ${p.suppression?`<button onclick="deleteRate('${r._id}')">❌</button>`:''}
      </td>
    </tr>`;
  });
  html+='</table>';

  /* ------------------ SCRIPT CLIENT JS ------------------ */
  html+=`<script>
let currentTransfertId=null, currentStockId=null, currentClientId=null, currentRateId=null;

function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

/* ===== TRANSFERT ===== */
function openTransfertModal(id=null){currentTransfertId=id;alert('Ouvre modal Transfert '+id);}
function saveTransfert(){postData('/transfert/new',{_id:currentTransfertId}).then(()=>location.reload());}
function deleteTransfert(id){if(confirm('Supprimer ?'))postData('/transfert/delete',{id}).then(()=>location.reload());}
function retirerTransfert(id){if(confirm('Retirer ?'))postData('/transfert/retirer',{id,mode:'ESPECE'}).then(()=>location.reload());}

/* ===== STOCK ===== */
function openStockModal(id=null){currentStockId=id;alert('Ouvre modal Stock '+id);}
function saveStock(){postData('/stock/new',{_id:currentStockId}).then(()=>location.reload());}
function deleteStock(id){if(confirm('Supprimer ?'))postData('/stock/delete',{id}).then(()=>location.reload());}

/* ===== CLIENT ===== */
function openClientModal(id=null){currentClientId=id;alert('Ouvre modal Client '+id);}
function saveClient(){postData('/client/new',{_id:currentClientId}).then(()=>location.reload());}
function deleteClient(id){if(confirm('Supprimer ?'))postData('/client/delete',{id}).then(()=>location.reload());}

/* ===== RATE ===== */
function openRateModal(id=null){currentRateId=id;alert('Ouvre modal Rate '+id);}
function saveRate(){postData('/rate/new',{_id:currentRateId}).then(()=>location.reload());}
function deleteRate(id){if(confirm('Supprimer ?'))postData('/rate/delete',{id}).then(()=>location.reload());}

function exportPDF(){window.open('/export/pdf','_blank');}
function exportExcel(){window.open('/export/excel','_blank');}
</script>`;

  html+='</body></html>';
  res.send(html);
});

/* ================== SERVER ================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('🚀 Serveur lancé sur le port '+PORT));
