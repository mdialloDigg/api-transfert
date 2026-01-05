/******************************************************************
 * APP COMPLET : TRANSFERTS + STOCKS + CLIENTS + RATES + EXPORT
 * Dashboard avec CRUD complet, modals, recherche multicritère
 * Frontend intégré + AJAX + CSS responsive
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
  if(username === 'a'){
    return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  }
  if(username === 'admin2'){
    return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  }
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
.login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
.login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
.login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
.login-container button:hover{background:#e67300;}
</style>
</head>
<body>
<div class="login-container">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div>
</body>
</html>`);
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

/* ================== DASHBOARD ================== */
app.get('/dashboard', requireLogin, async(req,res)=>{
  const p=req.session.user.permissions;
  res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
h2,h3,h4{margin-top:20px;color:#333;}
a{margin-right:10px;text-decoration:none;color:#007bff;}a:hover{text-decoration:underline;}
table{border-collapse:collapse;width:100%;margin-bottom:20px;}
th,td{border:1px solid #ccc;padding:8px;text-align:left;}
th{background:#ff8c42;color:white;}
button{margin:2px;padding:5px 10px;cursor:pointer;border:none;border-radius:5px;background:#ff8c42;color:white;}
button:hover{background:#e67300;}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
.modal-content{background:white;padding:20px;border-radius:10px;max-width:500px;width:90%;overflow:auto;}
input,select{width:100%;padding:6px;margin-bottom:10px;border:1px solid #ccc;border-radius:5px;}
</style>
</head>
<body>
<h2>📊 Dashboard</h2>
<a href="/logout">🚪 Déconnexion</a>
<div id="content">
<h3>Transferts</h3><div id="transferts"></div>
<h3>Stocks</h3><div id="stocks"></div>
<h3>Clients</h3><div id="clients"></div>
<h3>Taux de change</h3><div id="rates"></div>
</div>

<script>
// ================= AJAX UTILS =================
async function getJSON(url){ return await (await fetch(url)).json(); }
async function postJSON(url,data){ return await (await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json(); }

// ================= RENDERING =================
async function loadData(){
  const transferts = await getJSON('/api/transferts');
  const stocks = await getJSON('/api/stocks');
  const clients = await getJSON('/api/clients');
  const rates = await getJSON('/api/rates');

  // TRANSFERTS
  let tHTML='<table><tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Currency</th><th>Actions</th></tr>';
  transferts.forEach(t=>{
    tHTML+=\`<tr>
      <td>\${t.code}</td>
      <td>\${t.senderFirstName} \${t.senderLastName}</td>
      <td>\${t.receiverFirstName} \${t.receiverLastName}</td>
      <td>\${t.amount}</td>
      <td>\${t.currency}</td>
      <td>
      <button onclick="retirer('\${t._id}')">Retirer</button>
      <button onclick="supprimerTransfert('\${t._id}')">Supprimer</button>
      </td>
    </tr>\`;
  });
  tHTML+='</table>'; document.getElementById('transferts').innerHTML=tHTML;

  // STOCKS
  let sHTML='<table><tr><th>Code</th><th>Sender</th><th>Destination</th><th>Amount</th><th>Actions</th></tr>';
  stocks.forEach(s=>{
    sHTML+=\`<tr>
      <td>\${s.code}</td>
      <td>\${s.sender}</td>
      <td>\${s.destination}</td>
      <td>\${s.amount}</td>
      <td><button onclick="supprimerStock('\${s._id}')">Supprimer</button></td>
    </tr>\`;
  });
  sHTML+='</table>'; document.getElementById('stocks').innerHTML=sHTML;

  // CLIENTS
  let cHTML='<table><tr><th>Nom</th><th>Phone</th><th>Email</th><th>Actions</th></tr>';
  clients.forEach(c=>{
    cHTML+=\`<tr>
      <td>\${c.firstName} \${c.lastName}</td>
      <td>\${c.phone}</td>
      <td>\${c.email}</td>
      <td><button onclick="supprimerClient('\${c._id}')">Supprimer</button></td>
    </tr>\`;
  });
  cHTML+='</table>'; document.getElementById('clients').innerHTML=cHTML;

  // RATES
  let rHTML='<table><tr><th>From</th><th>To</th><th>Rate</th><th>Actions</th></tr>';
  rates.forEach(r=>{
    rHTML+=\`<tr>
      <td>\${r.from}</td>
      <td>\${r.to}</td>
      <td>\${r.rate}</td>
      <td><button onclick="supprimerRate('\${r._id}')">Supprimer</button></td>
    </tr>\`;
  });
  rHTML+='</table>'; document.getElementById('rates').innerHTML=rHTML;
}
loadData();

// ================= ACTIONS =================
async function retirer(id){ if(confirm('Confirmer retrait ?')){ await postJSON('/api/transfert/retrait',{id}); loadData(); } }
async function supprimerTransfert(id){ if(confirm('Supprimer ?')){ await postJSON('/api/transfert/delete',{id}); loadData(); } }
async function supprimerStock(id){ if(confirm('Supprimer ?')){ await postJSON('/api/stock/delete',{id}); loadData(); } }
async function supprimerClient(id){ if(confirm('Supprimer ?')){ await postJSON('/api/client/delete',{id}); loadData(); } }
async function supprimerRate(id){ if(confirm('Supprimer ?')){ await postJSON('/api/rate/delete',{id}); loadData(); } }

</script>
</body>
</html>
`);  
});

/* ================= API ================= */
app.get('/api/transferts', requireLogin, async(req,res)=>{ res.json(await Transfert.find().sort({createdAt:-1})); });
app.post('/api/transfert/retrait', requireLogin, async(req,res)=>{
  const {id}=req.body; 
  let t=await Transfert.findById(id); 
  if(t && !t.retired){ t.retired=true; t.retraitHistory.push({date:new Date(),mode:'Retrait'}); await t.save(); }
  res.json({ok:true});
});
app.post('/api/transfert/delete', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); });

app.get('/api/stocks', requireLogin, async(req,res)=>{ res.json(await Stock.find().sort({createdAt:-1})); });
app.post('/api/stock/delete', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.body.id); res.json({ok:true}); });

app.get('/api/clients', requireLogin, async(req,res)=>{ res.json(await Client.find().sort({createdAt:-1})); });
app.post('/api/client/delete', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.body.id); res.json({ok:true}); });

app.get('/api/rates', requireLogin, async(req,res)=>{ res.json(await Rate.find().sort({createdAt:-1})); });
app.post('/api/rate/delete', requireLogin, async(req,res)=>{ await Rate.findByIdAndDelete(req.body.id); res.json({ok:true}); });

/* ================== SERVER ================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur port '+PORT));
