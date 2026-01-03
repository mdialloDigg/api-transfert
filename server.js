/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION TOUT-EN-UN COMPLETE
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ MongoDB indisponible:', err.message));

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], default:'Client' },
  senderFirstName: String, senderLastName: String, senderPhone: String, originLocation: String,
  receiverFirstName: String, receiverLastName: String, receiverPhone: String, destinationLocation: String,
  amount: Number, fees: Number, recoveryAmount: Number, currency: { type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode: String, retraitHistory: [{ date:Date, mode:String }], retired: { type:Boolean, default:false },
  code: { type:String, unique:true }, createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code: String, sender: String, destination: String, amount: Number,
  currency: { type:String, default:'GNF' }, createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  action: String, stockId: mongoose.Schema.Types.ObjectId,
  sender: String, destination: String, amount: Number, currency: String,
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

const authSchema = new mongoose.Schema({ username: String, password: String });
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
const requireLogin = (req,res,next) => { if(!req.session.user) return res.redirect('/login'); next(); };
async function generateCode(){ let code,exists=true; while(exists){ code=String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(100+Math.random()*900); exists=await Transfert.findOne({code})||await Stock.findOne({code}); } return code; }

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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

app.post('/login',async (req,res)=>{
  try{
    let user = await Auth.findOne({username:req.body.username});
    if(!user){ const hashed=bcrypt.hashSync(req.body.password,10); user=await Auth.create({username:req.body.username,password:hashed}); }
    if(!bcrypt.compareSync(req.body.password,user.password)) return res.redirect('/login');
    req.session.user=user.username;
    res.redirect('/dashboard');
  }catch(e){ res.redirect('/login'); }
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

/* ================= DASHBOARD ================= */
app.get('/dashboard',requireLogin,async (req,res)=>{
  try{
    const transferts = await Transfert.find().sort({createdAt:-1});
    const stocks = await Stock.find().sort({createdAt:-1});
    const history = await StockHistory.find().sort({date:-1});

    res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
table{width:100%;border-collapse:collapse;margin-bottom:20px;}
th,td{border:1px solid #ccc;padding:8px;text-align:left;}
th{background:#ff8c42;color:white;}
button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;margin-right:3px;font-size:12px;}
.modify{background:#28a745;} .delete{background:#dc3545;} .retirer{background:#ff9900;}
input,select{padding:5px;margin-right:5px;}
.error{background:#dc3545;color:white;padding:10px;margin-bottom:10px;}
</style></head><body>
<h2>📊 Dashboard</h2>
<a href="/logout">🚪 Déconnexion</a>
<div id="errorBox" class="error" style="display:none"></div>

<h3>Ajouter un Transfert</h3>
<form onsubmit="addTransfert(event)">
<input id="senderFirst" placeholder="Prénom Expéditeur" required>
<input id="senderLast" placeholder="Nom Expéditeur">
<input id="senderPhone" placeholder="Tel Expéditeur">
<input id="originLoc" placeholder="Lieu Origine">
<input id="receiverFirst" placeholder="Prénom Destinataire" required>
<input id="receiverLast" placeholder="Nom Destinataire">
<input id="receiverPhone" placeholder="Tel Destinataire">
<input id="destLoc" placeholder="Destination">
<input id="amount" type="number" placeholder="Montant" required>
<input id="fees" type="number" placeholder="Frais">
<input id="recovery" type="number" placeholder="Reçu">
<select id="currency"><option value="GNF">GNF</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="XOF">XOF</option></select>
<button>Ajouter</button></form>

<h3>Transferts</h3>
<table>
<tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
${transferts.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.amount}</td>
<td>${t.fees||0}</td>
<td>${t.recoveryAmount||t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
<button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
</td>
</tr>`).join('')}
</table>

<h3>Stocks</h3>
<form onsubmit="addStock(event)">
<input id="stockSender" placeholder="Expéditeur" required>
<input id="stockDest" placeholder="Destination" required>
<input id="stockAmount" type="number" placeholder="Montant" required>
<select id="stockCurrency"><option value="GNF">GNF</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="XOF">XOF</option></select>
<button>Ajouter Stock</button>
</form>

<table>
<tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>
${stocks.map(s=>`
<tr>
<td>${s.code}</td>
<td>${s.sender}</td>
<td>${s.destination}</td>
<td>${s.amount}</td>
<td>${s.currency}</td>
<td>
<button class="modify" onclick="editStock('${s._id}')">✏️</button>
<button class="delete" onclick="deleteStock('${s._id}')">❌</button>
</td>
</tr>`).join('')}
</table>

<h3>Historique Stocks</h3>
<table>
<tr><th>Date</th><th>Action</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>
${history.map(h=>`
<tr>
<td>${new Date(h.date).toLocaleString()}</td>
<td>${h.action}</td>
<td>${h.stockId||''}</td>
<td>${h.sender}</td>
<td>${h.destination}</td>
<td>${h.amount}</td>
</tr>`).join('')}
</table>

<script>
function showError(msg){const box=document.getElementById('errorBox');box.innerText=msg;box.style.display='block';}
async function api(url,data){try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!j.ok) throw j.message||'Erreur'; location.reload();}catch(e){showError(e);}}

function addTransfert(e){e.preventDefault();api('/transferts/save',{
senderFirstName:senderFirst.value,senderLastName:senderLast.value,senderPhone:senderPhone.value,originLocation:originLoc.value,
receiverFirstName:receiverFirst.value,receiverLastName:receiverLast.value,receiverPhone:receiverPhone.value,destinationLocation:destLoc.value,
amount:+amount.value,fees:+fees.value||0,recoveryAmount:+recovery.value||+amount.value,currency:currency.value});}
function editTransfert(id){fetch('/transferts/get/'+id).then(r=>r.json()).then(t=>{
const sFirst=prompt('Prénom Expéditeur',t.senderFirstName)||t.senderFirstName;
const sLast=prompt('Nom Expéditeur',t.senderLastName)||t.senderLastName;
const sPhone=prompt('Tel Expéditeur',t.senderPhone)||t.senderPhone;
const origin=prompt('Lieu Origine',t.originLocation)||t.originLocation;
const rFirst=prompt('Prénom Destinataire',t.receiverFirstName)||t.receiverFirstName;
const rLast=prompt('Nom Destinataire',t.receiverLastName)||t.receiverLastName;
const rPhone=prompt('Tel Destinataire',t.receiverPhone)||t.receiverPhone;
const dest=prompt('Destination',t.destinationLocation)||t.destinationLocation;
const amount=+prompt('Montant',t.amount)||t.amount;
const fees=+prompt('Frais',t.fees)||t.fees;
const recovery=+prompt('Reçu',t.recoveryAmount)||t.recoveryAmount;
const currency=prompt('Devise',t.currency)||t.currency;
api('/transferts/save',{_id:id,senderFirstName:sFirst,senderLastName:sLast,senderPhone:sPhone,originLocation:origin,
receiverFirstName:rFirst,receiverLastName:rLast,receiverPhone:rPhone,destinationLocation:dest,amount,fees,recoveryAmount:recovery,currency});
});}
function deleteTransfert(id){if(confirm('Supprimer ?')) api('/transferts/delete',{id});}
function retirerTransfert(id){const mode=prompt('Mode retrait','Espèces'); if(mode) api('/transferts/retirer',{id,mode});}

// Stocks
function addStock(e){e.preventDefault();api('/stocks/save',{sender:stockSender.value,destination:stockDest.value,amount:+stockAmount.value,currency:stockCurrency.value});}
function editStock(id){fetch('/stocks/get/'+id).then(r=>r.json()).then(s=>{
const sender=prompt('Expéditeur',s.sender)||s.sender;
const dest=prompt('Destination',s.destination)||s.destination;
const amount=+prompt('Montant',s.amount)||s.amount;
const currency=prompt('Devise',s.currency)||s.currency;
api('/stocks/save',{_id:id,sender,destination:dest,amount,currency});});}
function deleteStock(id){if(confirm('Supprimer ?')) api('/stocks/delete',{id});}
</script>

</body></html>
`);
});

/* ================= TRANSFERT ROUTES ================= */
app.post('/transferts/save',requireLogin,async(req,res)=>{try{if(req.body._id) await Transfert.findByIdAndUpdate(req.body._id,req.body); else{const code=await generateCode(); await Transfert.create({...req.body,code,retraitHistory:[]});} res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:'Erreur Transfert'});}});
app.post('/transferts/delete',requireLogin,async(req,res)=>{try{await Transfert.findByIdAndDelete(req.body.id);res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:'Erreur'});}});
app.post('/transferts/retirer',requireLogin,async(req,res)=>{try{const t=await Transfert.findById(req.body.id); if(!t) return res.json({ok:false,message:'Introuvable'}); t.retired=true; t.retraitHistory.push({date:new Date(),mode:req.body.mode}); await t.save(); res.json({ok:true});}catch(e){res.status(500).json({ok:false,message:'Erreur'});}});
app.get('/transferts/get/:id',requireLogin,async(req,res)=>{try{const t=await Transfert.findById(req.params.id);res.json(t);}catch(e){res.status(500).json({ok:false,message:'Erreur'});}});

/* ================= STOCK ROUTES ================= */
app.post('/stocks/save',requireLogin,async(req,res)=>{
  try{
    if(req.body._id) await Stock.findByIdAndUpdate(req.body._id,req.body);
    else{
      const code=await generateCode();
      await Stock.create({...req.body,code});
      await StockHistory.create({action:'Ajout',stockId:null,...req.body});
    }
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,message:'Erreur Stock'});}
});
app.post('/stocks/delete',requireLogin,async(req,res)=>{
  try{
    const s=await Stock.findByIdAndDelete(req.body.id);
    if(s) await StockHistory.create({action:'Suppression',stockId:s._id,...s.toObject()});
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,message:'Erreur'});}
});
app.get('/stocks/get/:id',requireLogin,async(req,res)=>{
  try{const s=await Stock.findById(req.params.id); res.json(s);}catch(e){res.status(500).json({ok:false,message:'Erreur'});}
});

/* ================= SERVER ================= */
app.use((err,req,res,next)=>{console.error(err);res.status(502).send('Bad Gateway');});
const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log('🚀 Serveur prêt sur '+PORT));
