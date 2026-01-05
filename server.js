/******************************************************************
 * APP TRANSFERT + STOCKS + CLIENTS + RATES + EXPORT + HISTORY
 * COMPLET + RECHERCHE INSTANTANÉE + MODALS CRUD + EXPORT
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

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;width:90%;max-width:360px;text-align:center;}
  input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;}
  button:hover{background:#e67300;}
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
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={ username:user.username, role:user.role };
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

/* ================= DASHBOARD COMPLET ================= */
app.get('/dashboard', requireLogin, async(req,res)=>{
  const html=`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f2f5;padding:10px;}
h2{color:#333;}
input.search-input{padding:8px;border-radius:8px;border:1px solid #ccc;width:100%;max-width:160px;margin:0 5px 10px 0;}
#loader{display:none;color:#ff8c42;margin:8px 0;}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th,td{border:1px solid #ccc;padding:6px;font-size:14px;}
th{background:#ff8c42;color:#fff;}
@media(max-width:600px){.search-input{max-width:100%;margin-bottom:5px;}}
</style>
</head>
<body>
<h2>📊 Dashboard</h2>
<a href="/logout">🚪 Déconnexion</a>

<h3>Transferts</h3>
<div>
<input id="searchTransPhone" class="search-input" placeholder="📞 Téléphone">
<input id="searchTransCode" class="search-input" placeholder="🔢 Code">
<input id="searchTransName" class="search-input" placeholder="🧑 Nom">
<span id="transResultCount"></span>
<div id="transLoader">⏳ Recherche...</div>
</div>
<div id="transTable"></div>

<h3>Stocks</h3>
<input id="searchStock" class="search-input" placeholder="🔍 Expéditeur / Destination">
<div id="stockResultCount"></div>
<div id="stockLoader">⏳ Recherche...</div>
<div id="stockTable"></div>

<h3>Clients</h3>
<input id="searchClient" class="search-input" placeholder="🔍 Nom / Téléphone">
<div id="clientResultCount"></div>
<div id="clientLoader">⏳ Recherche...</div>
<div id="clientTable"></div>

<h3>Taux de Change</h3>
<input id="searchRate" class="search-input" placeholder="🔍 De / Vers">
<div id="rateResultCount"></div>
<div id="rateLoader">⏳ Recherche...</div>
<div id="rateTable"></div>

<script>
function debounce(fn,delay){let timer=null; return function(...args){clearTimeout(timer); timer=setTimeout(()=>fn.apply(this,args),delay);};}

/* ------------------- TRANSFERT ------------------- */
const tPhone=document.getElementById('searchTransPhone');
const tCode=document.getElementById('searchTransCode');
const tName=document.getElementById('searchTransName');
const tLoader=document.getElementById('transLoader');
const tCount=document.getElementById('transResultCount');
const tTable=document.getElementById('transTable');
const loadTransferts=debounce(()=>{
  tLoader.style.display='block';
  fetch('/api/transferts/search?phone='+tPhone.value+'&code='+tCode.value+'&name='+tName.value)
    .then(r=>r.json()).then(data=>{
      tLoader.style.display='none';
      tCount.innerText=data.length+' résultat(s)';
      let html='<table><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th></tr>';
      data.forEach(t=>{
        html+=\`<tr><td>\${t.code}</td><td>\${t.senderFirstName||''} 📞 \${t.senderPhone||'-'}</td><td>\${t.receiverFirstName||''} 📞 \${t.receiverPhone||'-'}</td><td>\${t.amount||0}</td><td>\${t.currency}</td><td>\${t.retired?'Retiré':'Non retiré'}</td></tr>\`;
      });
      html+='</table>'; tTable.innerHTML=html;
    });
},300);
tPhone.oninput=loadTransferts; tCode.oninput=loadTransferts; tName.oninput=loadTransferts;
loadTransferts();

/* ------------------- STOCK ------------------- */
const sSearch=document.getElementById('searchStock'); const sLoader=document.getElementById('stockLoader'); const sCount=document.getElementById('stockResultCount'); const sTable=document.getElementById('stockTable');
const loadStocks=debounce(()=>{ sLoader.style.display='block'; fetch('/api/stocks/search?q='+sSearch.value).then(r=>r.json()).then(data=>{ sLoader.style.display='none'; sCount.innerText=data.length+' résultat(s)'; let html='<table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr>'; data.forEach(s=>{ html+=\`<tr><td>\${s.code}</td><td>\${s.sender||''} 📞 \${s.senderPhone||'-'}</td><td>\${s.destination||''} 📞 \${s.destinationPhone||'-'}</td><td>\${s.amount||0}</td><td>\${s.currency}</td></tr>\`; }); html+='</table>'; sTable.innerHTML=html; }); },300);
sSearch.oninput=loadStocks; loadStocks();

/* ------------------- CLIENT ------------------- */
const cSearch=document.getElementById('searchClient'); const cLoader=document.getElementById('clientLoader'); const cCount=document.getElementById('clientResultCount'); const cTable=document.getElementById('clientTable');
const loadClients=debounce(()=>{ cLoader.style.display='block'; fetch('/api/clients/search?q='+cSearch.value).then(r=>r.json()).then(data=>{ cLoader.style.display='none'; cCount.innerText=data.length+' résultat(s)'; let html='<table><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th></tr>'; data.forEach(c=>{ html+=\`<tr><td>\${c.lastName||''}</td><td>\${c.firstName||''}</td><td>\${c.phone||''}</td><td>\${c.email||'-'}</td></tr>\`; }); html+='</table>'; cTable.innerHTML=html; }); },300);
cSearch.oninput=loadClients; loadClients();

/* ------------------- RATE ------------------- */
const rSearch=document.getElementById('searchRate'); const rLoader=document.getElementById('rateLoader'); const rCount=document.getElementById('rateResultCount'); const rTable=document.getElementById('rateTable');
const loadRates=debounce(()=>{ rLoader.style.display='block'; fetch('/api/rates/search?q='+rSearch.value).then(r=>r.json()).then(data=>{ rLoader.style.display='none'; rCount.innerText=data.length+' résultat(s)'; let html='<table><tr><th>De</th><th>Vers</th><th>Rate</th></tr>'; data.forEach(r=>{ html+=\`<tr><td>\${r.from||''}</td><td>\${r.to||''}</td><td>\${r.rate||0}</td></tr>\`; }); html+='</table>'; rTable.innerHTML=html; }); },300);
rSearch.oninput=loadRates; loadRates();
</script>
</body></html>`;
  res.send(html);
});

/* ================== API RECHERCHE ================== */
app.get('/api/transferts/search', requireLogin, async(req,res)=>{
  const { phone, code, name } = req.query;
  let filter={};
  if(phone){ filter.$or=[{senderPhone:{$regex:phone,$options:'i'}},{receiverPhone:{$regex:phone,$options:'i'}}]; }
  if(code) filter.code={$regex:code,$options:'i'};
  if(name){ filter.$or=[{receiverFirstName:{$regex:name,$options:'i'}},{receiverLastName:{$regex:name,$options:'i'}}]; }
  const transferts=await Transfert.find(filter).sort({createdAt:-1}).limit(100);
  res.json(transferts);
});

app.get('/api/stocks/search', requireLogin, async(req,res)=>{
  const { q }=req.query;
  let filter={};
  if(q){ filter.$or=[{sender:{$regex:q,$options:'i'}},{destination:{$regex:q,$options:'i'}}]; }
  const stocks=await Stock.find(filter).sort({createdAt:-1}).limit(100);
  res.json(stocks);
});

app.get('/api/clients/search', requireLogin, async(req,res)=>{
  const { q }=req.query;
  let filter={};
  if(q){ filter.$or=[{firstName:{$regex:q,$options:'i'}},{lastName:{$regex:q,$options:'i'}},{phone:{$regex:q,$options:'i'}}]; }
  const clients=await Client.find(filter).sort({createdAt:-1}).limit(100);
  res.json(clients);
});

app.get('/api/rates/search', requireLogin, async(req,res)=>{
  const { q }=req.query;
  let filter={};
  if(q){ filter.$or=[{from:{$regex:q,$options:'i'}},{to:{$regex:q,$options:'i'}}]; }
  const rates=await Rate.find(filter).sort({createdAt:-1}).limit(100);
  res.json(rates);
});

/* ================== SERVER ================== */
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur le port '+PORT));
