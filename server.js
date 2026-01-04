/******************************************************************
 * APP TRANSFERT + STOCKS + CLIENTS + TAUX – VERSION COMPLETE
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

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
  kycVerified: { type: Boolean, default:false }
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({
  from: String,
  to: String,
  rate: Number
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
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={ username:user.username, role:user.role };
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const clients = await Client.find().sort({lastName:1});
  const rates = await Rate.find();

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f2f5;padding:20px;}
  h2,h3{color:#333;}
  table{border-collapse:collapse;width:100%;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:8px;text-align:left;}
  th{background:#ff8c42;color:white;}
  button{padding:5px 10px;margin:2px;cursor:pointer;border:none;border-radius:5px;}
  button.add{background:#28a745;color:white;}
  button.edit{background:#007bff;color:white;}
  button.delete{background:#dc3545;color:white;}
  .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
  .modal-content{background:white;padding:20px;border-radius:10px;width:90%;max-width:400px;}
  </style></head><body>
  <h2>📊 Dashboard</h2>
  <a href="/logout">Déconnexion</a>
  <h3>Transferts</h3>
  <button class="add" onclick="openTransfertModal()">+ Nouveau Transfert</button>
  <table><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;

  transferts.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName}</td>
      <td>${t.receiverFirstName}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.received}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <button class="edit" onclick="editTransfert('${t._id}')">✏️</button>
        <button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
      </td>
    </tr>`;
  });
  html+=`</table>
  <h3>Stocks</h3>
  <button class="add" onclick="openStockModal()">+ Nouveau Stock</button>
  <table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{
    html+=`<tr>
      <td>${s.code}</td>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
        <button class="edit" onclick="editStock('${s._id}')">✏️</button>
        <button class="delete" onclick="deleteStock('${s._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table>
  <h3>Clients KYC</h3>
  <button class="add" onclick="openClientModal()">+ Nouveau Client</button>
  <table><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr>`;
  clients.forEach(c=>{
    html+=`<tr>
      <td>${c.lastName}</td>
      <td>${c.firstName}</td>
      <td>${c.phone}</td>
      <td>${c.email}</td>
      <td>${c.kycVerified?'Oui':'Non'}</td>
      <td>
        <button class="edit" onclick="editClient('${c._id}')">✏️</button>
        <button class="delete" onclick="deleteClient('${c._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table>
  <h3>Taux / Devise</h3>
  <button class="add" onclick="openRateModal()">+ Nouveau Taux</button>
  <table><tr><th>De</th><th>Vers</th><th>Taux</th><th>Actions</th></tr>`;
  rates.forEach(r=>{
    html+=`<tr>
      <td>${r.from}</td>
      <td>${r.to}</td>
      <td>${r.rate}</td>
      <td>
        <button class="edit" onclick="editRate('${r._id}')">✏️</button>
        <button class="delete" onclick="deleteRate('${r._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table>
  <div id="modal" class="modal"><div class="modal-content" id="modal-content"></div></div>
  <script>
  let currentId=null;
  function openModal(title,content){currentId=null;document.getElementById('modal-content').innerHTML='<h3>'+title+'</h3>'+content+'<br><button onclick="closeModal()">Fermer</button>';document.getElementById('modal').style.display='flex';}
  function closeModal(){document.getElementById('modal').style.display='none';currentId=null;}

  async function post(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
  async function deleteRequest(url){return fetch(url,{method:'DELETE'}).then(r=>r.json());}

  // === TRANSFERTS ===
  function openTransfertModal(){const html='Expéditeur:<input id="t_sender"><br>Destinataire:<input id="t_receiver"><br>Montant:<input id="t_amount" type="number"><br>Frais:<input id="t_fees" type="number"><br>Devise:<select id="t_currency"><option>GNF</option><option>EUR</option><option>USD</option><option>XOF</option></select><br><button onclick="saveTransfert()">Enregistrer</button>';openModal('Transfert',html);}
  async function saveTransfert(){const data={senderFirstName:document.getElementById('t_sender').value,receiverFirstName:document.getElementById('t_receiver').value,amount:parseFloat(document.getElementById('t_amount').value),fees:parseFloat(document.getElementById('t_fees').value),received:parseFloat(document.getElementById('t_amount').value)-parseFloat(document.getElementById('t_fees').value),currency:document.getElementById('t_currency').value};if(currentId)data._id=currentId;await post('/transferts/save',data);location.reload();}
  async function editTransfert(id){const t=await(await fetch('/transferts/'+id)).json();currentId=id;openModal('Modifier Transfert','Expéditeur:<input id="t_sender" value="'+t.senderFirstName+'"><br>Destinataire:<input id="t_receiver" value="'+t.receiverFirstName+'"><br>Montant:<input id="t_amount" type="number" value="'+t.amount+'"><br>Frais:<input id="t_fees" type="number" value="'+t.fees+'"><br>Devise:<select id="t_currency"><option '+(t.currency==='GNF'?'selected':'')+'>GNF</option><option '+(t.currency==='EUR'?'selected':'')+'>EUR</option><option '+(t.currency==='USD'?'selected':'')+'>USD</option><option '+(t.currency==='XOF'?'selected':'')+'>XOF</option></select><br><button onclick="saveTransfert()">Enregistrer</button>');}
  async function deleteTransfert(id){if(confirm('Supprimer?')){await deleteRequest('/transferts/delete/'+id);location.reload();}}
  async function retirerTransfert(id){if(confirm('Retirer?')){await post('/transferts/retirer/'+id,{mode:'ESPECE'});location.reload();}}

  // === STOCKS ===
  function openStockModal(){const html='Expéditeur:<input id="s_sender"><br>Destination:<input id="s_destination"><br>Montant:<input id="s_amount" type="number"><br>Devise:<select id="s_currency"><option>GNF</option><option>EUR</option><option>USD</option><option>XOF</option></select><br><button onclick="saveStock()">Enregistrer</button>';openModal('Stock',html);}
  async function saveStock(){const data={sender:document.getElementById('s_sender').value,destination:document.getElementById('s_destination').value,amount:parseFloat(document.getElementById('s_amount').value),currency:document.getElementById('s_currency').value};if(currentId)data._id=currentId;await post('/stocks/save',data);location.reload();}
  async function editStock(id){const s=await(await fetch('/stocks/'+id)).json();currentId=id;openModal('Modifier Stock','Expéditeur:<input id="s_sender" value="'+s.sender+'"><br>Destination:<input id="s_destination" value="'+s.destination+'"><br>Montant:<input id="s_amount" type="number" value="'+s.amount+'"><br>Devise:<select id="s_currency"><option '+(s.currency==='GNF'?'selected':'')+'>GNF</option><option '+(s.currency==='EUR'?'selected':'')+'>EUR</option><option '+(s.currency==='USD'?'selected':'')+'>USD</option><option '+(s.currency==='XOF'?'selected':'')+'>XOF</option></select><br><button onclick="saveStock()">Enregistrer</button>');}
  async function deleteStock(id){if(confirm('Supprimer?')){await deleteRequest('/stocks/delete/'+id);location.reload();}}

  // === CLIENTS ===
  function openClientModal(){const html='Nom:<input id="c_last"><br>Prénom:<input id="c_first"><br>Téléphone:<input id="c_phone"><br>Email:<input id="c_email"><br>KYC:<select id="c_kyc"><option value="true">Oui</option><option value="false">Non</option></select><br><button onclick="saveClient()">Enregistrer</button>';openModal('Client',html);}
  async function saveClient(){const data={lastName:document.getElementById('c_last').value,firstName:document.getElementById('c_first').value,phone:document.getElementById('c_phone').value,email:document.getElementById('c_email').value,kycVerified:document.getElementById('c_kyc').value==='true'};if(currentId)data._id=currentId;await post('/clients/save',data);location.reload();}
  async function editClient(id){const c=(await(await fetch('/clients')).json()).find(x=>x._id===id);currentId=id;openModal('Modifier Client','Nom:<input id="c_last" value="'+c.lastName+'"><br>Prénom:<input id="c_first" value="'+c.firstName+'"><br>Téléphone:<input id="c_phone" value="'+c.phone+'"><br>Email:<input id="c_email" value="'+c.email+'"><br>KYC:<select id="c_kyc"><option value="true" '+(c.kycVerified?'selected':'')+'>Oui</option><option value="false" '+(!c.kycVerified?'selected':'')+'>Non</option></select><br><button onclick="saveClient()">Enregistrer</button>');}
  async function deleteClient(id){if(confirm('Supprimer?')){await deleteRequest('/clients/delete/'+id);location.reload();}}

  // === RATES ===
  function openRateModal(){const html='De:<input id="r_from"><br>Vers:<input id="r_to"><br>Taux:<input id="r_rate" type="number" step="0.01"><br><button onclick="saveRate()">Enregistrer</button>';openModal('Taux',html);}
  async function saveRate(){const data={from:document.getElementById('r_from').value,to:document.getElementById('r_to').value,rate:parseFloat(document.getElementById('r_rate').value)};if(currentId)data._id=currentId;await post('/rates/save',data);location.reload();}
  async function editRate(id){const r=(await(await fetch('/rates')).json()).find(x=>x._id===id);currentId=id;openModal('Modifier Taux','De:<input id="r_from" value="'+r.from+'"><br>Vers:<input id="r_to" value="'+r.to+'"><br>Taux:<input id="r_rate" type="number" step="0.01" value="'+r.rate+'"><br><button onclick="saveRate()">Enregistrer</button>');}
  async function deleteRate(id){if(confirm('Supprimer?')){await deleteRequest('/rates/delete/'+id);location.reload();}}
  </script>
  </body></html>`;
  res.send(html);
});

// ================= API TRANSFERTS =================
app.get('/transferts', requireLogin, async(req,res)=>{ const t = await Transfert.find(); res.json(t); });
app.get('/transferts/:id', requireLogin, async(req,res)=>{ const t = await Transfert.findById(req.params.id); res.json(t); });
app.post('/transferts/save', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id){ await Transfert.findByIdAndUpdate(data._id,data); }
  else{ data.code = await generateUniqueCode(); await new Transfert(data).save(); }
  res.json({success:true});
});
app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.params.id); res.json({success:true}); });
app.post('/transferts/retirer/:id', requireLogin, async(req,res)=>{
  const t=await Transfert.findById(req.params.id);
  if(t){ t.retired=true; t.retraitHistory.push({date:new Date(),mode:req.body.mode || 'ESPECE'}); await t.save(); }
  res.json({success:true});
});

// ================= API STOCKS =================
app.get('/stocks', requireLogin, async(req,res)=>{ const s = await Stock.find(); res.json(s); });
app.get('/stocks/:id', requireLogin, async(req,res)=>{ const s = await Stock.findById(req.params.id); res.json(s); });
app.post('/stocks/save', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id){ await Stock.findByIdAndUpdate(data._id,data); }
  else{ data.code = await generateUniqueCode(); await new Stock(data).save(); }
  res.json({success:true});
});
app.delete('/stocks/delete/:id', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.params.id); res.json({success:true}); });

// ================= API CLIENTS =================
app.get('/clients', requireLogin, async(req,res)=>{ const c = await Client.find(); res.json(c); });
app.post('/clients/save', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id){ await Client.findByIdAndUpdate(data._id,data); }
  else{ await new Client(data).save(); }
  res.json({success:true});
});
app.delete('/clients/delete/:id', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.params.id); res.json({success:true}); });

// ================= API RATES =================
app.get('/rates', requireLogin, async(req,res)=>{ const r = await Rate.find(); res.json(r); });
app.post('/rates/save', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id){ await Rate.findByIdAndUpdate(data._id,data); }
  else{ await new Rate(data).save(); }
  res.json({success:true});
});
app.delete('/rates/delete/:id', requireLogin, async(req,res)=>{ await Rate.findByIdAndDelete(req.params.id); res.json({success:true}); });

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
