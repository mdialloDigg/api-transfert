/******************************************************************
 * APP COMPLETE TRANSFERT + STOCKS + CLIENTS + TAUX + EXPORT PDF
 * TOUT EN UN SEUL FICHIER – CRUD + MODALS + DESIGN
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'transfert-secret-final', resave: false, saveUninitialized: true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert', { useNewUrlParser:true, useUnifiedTopology:true })
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{ console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, received:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code:{ type:String, unique:true }, sender:String, senderPhone:String, destination:String, destinationPhone:String,
  amount:Number, currency:{ type:String, default:'GNF' }, createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code:String, action:String, stockId:mongoose.Schema.Types.ObjectId,
  sender:String, senderPhone:String, destination:String, destinationPhone:String,
  amount:Number, currency:String, date:{ type:Date, default:Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{ type:String, enum:['admin','agent'], default:'agent' } });
const Auth = mongoose.model('Auth', authSchema);

const clientSchema = new mongoose.Schema({
  firstName:String, lastName:String, phone:String, email:String, kycVerified:{ type:Boolean, default:false }, createdAt:{ type:Date, default:Date.now }
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({ from:String, to:String, rate:Number });
const Rate = mongoose.model('Rate', rateSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter=String.fromCharCode(65+Math.floor(Math.random()*26));
    const number=Math.floor(100+Math.random()*900);
    code=`${letter}${number}`;
    exists=await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){ 
  if(username==='a') return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
  if(username==='admin2') return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}

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
  </style></head><body><div class="login-container"><h2>Connexion</h2>
  <form method="post"><input name="username" placeholder="Utilisateur" required>
  <input type="password" name="password" placeholder="Mot de passe" required>
  <button>Se connecter</button></form></div></body></html>`);
});

app.post('/login', async(req,res)=>{
  try{
    const {username,password}=req.body;
    let user=await Auth.findOne({username});
    if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user={username:user.username,role:user.role,permissions:setPermissions(username)};
    res.redirect('/dashboard');
  }catch(err){ console.error(err); res.status(500).send('Erreur login'); }
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const clients = await Client.find().sort({createdAt:-1});
  const rates = await Rate.find();

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;margin:0;background:#f0f2f5;padding:20px;}
  h2,h3,h4{margin-top:20px;color:#333;}
  a{color:#007bff;text-decoration:none;margin-right:10px;} a:hover{text-decoration:underline;}
  input,select,button{padding:8px;margin:5px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;}
  button{cursor:pointer;transition:0.3s;}
  button.modify{background:#28a745;color:white;}
  button.delete{background:#dc3545;color:white;}
  button.retirer{background:#ff9900;color:white;}
  button.print{background:#007bff;color:white;}
  .table-container{width:100%;overflow-x:auto;margin-bottom:20px;}
  table{border-collapse: collapse;width:100%;min-width:600px;}
  th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top;}
  th{background:#ff8c42;color:white;}
  @media(max-width:768px){
    table,thead,tbody,th,td,tr{display:block;}
    thead tr{display:none;}
    tr{margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px;}
    td{border:none;position:relative;padding-left:50%;text-align:left;}
    td::before{content:attr(data-label);position:absolute;left:10px;top:10px;font-weight:bold;white-space:nowrap;}
  }
  .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
  .modal-content{background:white;padding:20px;border-radius:10px;max-width:400px;width:90%;}
  .modal-content input,.modal-content select{width:100%;margin-bottom:10px;}
  </style></head><body>
  <h2>📊 Dashboard</h2><a href="/logout">🚪 Déconnexion</a>`;

  // ================= TRANSFERTS =================
  html+=`<h3>Transferts</h3><button onclick="openTransfertModal()">➕ Nouveau Transfert</button><button onclick="exportPDF('transfert')">📄 Export PDF</button>
  <div class="table-container"><table id="table-transfert"><tr><th>Code</th><th>Origin</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
  transferts.forEach(t=>{
    html+=`<tr>
      <td data-label="Code">${t.code}</td>
      <td data-label="Origin">${t.originLocation}</td>
      <td data-label="Expéditeur">${t.senderFirstName}</td>
      <td data-label="Destination">${t.destinationLocation}</td>
      <td data-label="Destinataire">${t.receiverFirstName}</td>
      <td data-label="Montant">${t.amount}</td>
      <td data-label="Frais">${t.fees}</td>
      <td data-label="Reçu">${t.received}</td>
      <td data-label="Devise">${t.currency}</td>
      <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
      <td data-label="Actions">
        <button onclick="openTransfertModal('${t._id}')">✏️</button>
        ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
        <button onclick="deleteTransfert('${t._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table></div>`;

  // ================= STOCKS =================
  html+=`<h3>Stocks</h3><button onclick="openStockModal()">➕ Nouveau Stock</button><button onclick="exportPDF('stock')">📄 Export PDF</button>
  <div class="table-container"><table id="table-stock"><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{
    html+=`<tr>
      <td data-label="Code">${s.code}</td>
      <td data-label="Expéditeur">${s.sender}</td>
      <td data-label="Destination">${s.destination}</td>
      <td data-label="Montant">${s.amount}</td>
      <td data-label="Devise">${s.currency}</td>
      <td data-label="Actions">
        <button onclick="openStockModal('${s._id}')">✏️</button>
        <button onclick="deleteStock('${s._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table></div>`;

  // ================= CLIENTS =================
  html+=`<h3>Clients KYC</h3><button onclick="openClientModal()">➕ Nouveau Client</button><button onclick="exportPDF('client')">📄 Export PDF</button>
  <div class="table-container"><table id="table-client"><tr><th>Nom</th><th>Prénom</th><th>Téléphone</th><th>Email</th><th>Vérifié</th><th>Actions</th></tr>`;
  clients.forEach(c=>{
    html+=`<tr>
      <td data-label="Nom">${c.lastName}</td>
      <td data-label="Prénom">${c.firstName}</td>
      <td data-label="Téléphone">${c.phone}</td>
      <td data-label="Email">${c.email||'-'}</td>
      <td data-label="Vérifié">${c.kycVerified?'Oui':'Non'}</td>
      <td data-label="Actions">
        <button onclick="openClientModal('${c._id}')">✏️</button>
        <button onclick="deleteClient('${c._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table></div>`;

  // ================= TAUX =================
  html+=`<h3>Taux / Devises</h3><button onclick="openRateModal()">➕ Nouveau Taux</button>
  <div class="table-container"><table id="table-rate"><tr><th>De</th><th>Vers</th><th>Taux</th><th>Actions</th></tr>`;
  rates.forEach(r=>{
    html+=`<tr>
      <td data-label="De">${r.from}</td>
      <td data-label="Vers">${r.to}</td>
      <td data-label="Taux">${r.rate}</td>
      <td data-label="Actions">
        <button onclick="openRateModal('${r._id}')">✏️</button>
        <button onclick="deleteRate('${r._id}')">❌</button>
      </td>
    </tr>`;
  });
  html+=`</table></div>`;

  // ================= MODALS (Transferts, Stocks, Clients, Taux) =================
  html+=`
<!-- TRANSFERT -->
<div id="transfertModal" class="modal"><div class="modal-content">
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

<!-- STOCK -->
<div id="stockModal" class="modal"><div class="modal-content">
<h3>Stock</h3>
<input id="s_code" readonly placeholder="Code généré">
<input id="s_sender" placeholder="Expéditeur">
<input id="s_senderPhone" placeholder="Téléphone expéditeur">
<input id="s_destination" placeholder="Destination">
<input id="s_destinationPhone" placeholder="Téléphone destinataire">
<input id="s_amount" type="number" placeholder="Montant">
<select id="s_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
<button onclick="saveStock()">Enregistrer</button>
<button onclick="closeStockModal()">Fermer</button>
</div></div>

<!-- CLIENT -->
<div id="clientModal" class="modal"><div class="modal-content">
<h3>Client KYC</h3>
<input id="c_firstName" placeholder="Prénom">
<input id="c_lastName" placeholder="Nom">
<input id="c_phone" placeholder="Téléphone">
<input id="c_email" placeholder="Email">
<select id="c_kyc"><option value="false">Non vérifié</option><option value="true">Vérifié</option></select>
<button onclick="saveClient()">Enregistrer</button>
<button onclick="closeClientModal()">Fermer</button>
</div></div>

<!-- TAUX -->
<div id="rateModal" class="modal"><div class="modal-content">
<h3>Taux</h3>
<input id="r_from" placeholder="De">
<input id="r_to" placeholder="Vers">
<input id="r_rate" type="number" placeholder="Taux">
<button onclick="saveRate()">Enregistrer</button>
<button onclick="closeRateModal()">Fermer</button>
</div></div>

<script>
/************* TRANSFERT JS *************/
let currentTransfertId=null;
function openTransfertModal(id=null){currentTransfertId=id;document.getElementById('transfertModal').style.display='flex'; if(id){ fetch('/transferts/get/'+id).then(r=>r.json()).then(t=>{ document.getElementById('t_code').value=t.code; document.getElementById('t_origin').value=t.originLocation; document.getElementById('t_sender').value=t.senderFirstName; document.getElementById('t_senderPhone').value=t.senderPhone; document.getElementById('t_destination').value=t.destinationLocation; document.getElementById('t_receiver').value=t.receiverFirstName; document.getElementById('t_receiverPhone').value=t.receiverPhone; document.getElementById('t_amount').value=t.amount; document.getElementById('t_fees').value=t.fees; document.getElementById('t_received').value=t.received; document.getElementById('t_currency').value=t.currency; document.getElementById('t_recoveryMode').value=t.recoveryMode; }); }else{document.getElementById('t_code').value='';document.getElementById('t_origin').value='';document.getElementById('t_sender').value='';document.getElementById('t_senderPhone').value='';document.getElementById('t_destination').value='';document.getElementById('t_receiver').value='';document.getElementById('t_receiverPhone').value='';document.getElementById('t_amount').value='';document.getElementById('t_fees').value='';document.getElementById('t_received').value='';document.getElementById('t_currency').value='GNF';document.getElementById('t_recoveryMode').value='ESPECE';}}
function closeTransfertModal(){document.getElementById('transfertModal').style.display='none';currentTransfertId=null;}
document.getElementById('t_amount')?.addEventListener('input',()=>{const a=parseFloat(document.getElementById('t_amount').value)||0; const f=parseFloat(document.getElementById('t_fees').value)||0; document.getElementById('t_received').value=a-f;});
document.getElementById('t_fees')?.addEventListener('input',()=>{const a=parseFloat(document.getElementById('t_amount').value)||0; const f=parseFloat(document.getElementById('t_fees').value)||0; document.getElementById('t_received').value=a-f;});
function saveTransfert(){const data={_id:currentTransfertId,originLocation:document.getElementById('t_origin').value,senderFirstName:document.getElementById('t_sender').value,senderPhone:document.getElementById('t_senderPhone').value,destinationLocation:document.getElementById('t_destination').value,receiverFirstName:document.getElementById('t_receiver').value,receiverPhone:document.getElementById('t_receiverPhone').value,amount:parseFloat(document.getElementById('t_amount').value),fees:parseFloat(document.getElementById('t_fees').value),received:parseFloat(document.getElementById('t_received').value),currency:document.getElementById('t_currency').value,recoveryMode:document.getElementById('t_recoveryMode').value}; fetch('/transferts/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();});}
function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){ fetch('/transferts/delete/'+id,{method:'DELETE'}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();}); }}
function retirerTransfert(id){if(confirm('Marquer comme retiré ?')){ fetch('/transferts/retrait/'+id,{method:'POST'}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();}); }}

/************* STOCK JS *************/
let currentStockId=null;
function openStockModal(id=null){currentStockId=id;document.getElementById('stockModal').style.display='flex';if(id){fetch('/stocks/get/'+id).then(r=>r.json()).then(s=>{document.getElementById('s_code').value=s.code;document.getElementById('s_sender').value=s.sender;document.getElementById('s_senderPhone').value=s.senderPhone;document.getElementById('s_destination').value=s.destination;document.getElementById('s_destinationPhone').value=s.destinationPhone;document.getElementById('s_amount').value=s.amount;document.getElementById('s_currency').value=s.currency;});}else{document.getElementById('s_code').value='';document.getElementById('s_sender').value='';document.getElementById('s_senderPhone').value='';document.getElementById('s_destination').value='';document.getElementById('s_destinationPhone').value='';document.getElementById('s_amount').value='';document.getElementById('s_currency').value='GNF';}}
function closeStockModal(){document.getElementById('stockModal').style.display='none';currentStockId=null;}
function saveStock(){const data={_id:currentStockId,sender:document.getElementById('s_sender').value,senderPhone:document.getElementById('s_senderPhone').value,destination:document.getElementById('s_destination').value,destinationPhone:document.getElementById('s_destinationPhone').value,amount:parseFloat(document.getElementById('s_amount').value),currency:document.getElementById('s_currency').value}; fetch('/stocks/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();});}
function deleteStock(id){if(confirm('Supprimer ce stock ?')){ fetch('/stocks/delete/'+id,{method:'DELETE'}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();}); }}

/************* CLIENT JS *************/
let currentClientId=null;
function openClientModal(id=null){currentClientId=id;document.getElementById('clientModal').style.display='flex';if(id){fetch('/clients/get/'+id).then(r=>r.json()).then(c=>{document.getElementById('c_firstName').value=c.firstName;document.getElementById('c_lastName').value=c.lastName;document.getElementById('c_phone').value=c.phone;document.getElementById('c_email').value=c.email;document.getElementById('c_kyc').value=c.kycVerified;});}else{document.getElementById('c_firstName').value='';document.getElementById('c_lastName').value='';document.getElementById('c_phone').value='';document.getElementById('c_email').value='';document.getElementById('c_kyc').value='false';}}
function closeClientModal(){document.getElementById('clientModal').style.display='none';currentClientId=null;}
function saveClient(){const data={_id:currentClientId,firstName:document.getElementById('c_firstName').value,lastName:document.getElementById('c_lastName').value,phone:document.getElementById('c_phone').value,email:document.getElementById('c_email').value,kycVerified:document.getElementById('c_kyc').value==='true'}; fetch('/clients/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();});}
function deleteClient(id){if(confirm('Supprimer ce client ?')){ fetch('/clients/delete/'+id,{method:'DELETE'}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();}); }}

/************* RATE JS *************/
let currentRateId=null;
function openRateModal(id=null){currentRateId=id;document.getElementById('rateModal').style.display='flex';if(id){fetch('/rates/get/'+id).then(r=>r.json()).then(r2=>{document.getElementById('r_from').value=r2.from;document.getElementById('r_to').value=r2.to;document.getElementById('r_rate').value=r2.rate;});}else{document.getElementById('r_from').value='';document.getElementById('r_to').value='';document.getElementById('r_rate').value='';}}
function closeRateModal(){document.getElementById('rateModal').style.display='none';currentRateId=null;}
function saveRate(){const data={_id:currentRateId,from:document.getElementById('r_from').value,to:document.getElementById('r_to').value,rate:parseFloat(document.getElementById('r_rate').value)}; fetch('/rates/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();});}
function deleteRate(id){if(confirm('Supprimer ce taux ?')){ fetch('/rates/delete/'+id,{method:'DELETE'}).then(r=>r.json()).then(d=>{alert(d.msg); location.reload();}); }}

/************* EXPORT PDF *************/
function exportPDF(type){window.open('/export/pdf?type='+type,'_blank');}
</script>`;

  html+=`</body></html>`;
  res.send(html);
});

// ================= CRUD TRANSFERT =================
app.get('/transferts/get/:id', requireLogin, async(req,res)=>{ const t=await Transfert.findById(req.params.id); res.json(t); });
app.post('/transferts/save', requireLogin, async(req,res)=>{ const d=req.body; if(d._id){ await Transfert.findByIdAndUpdate(d._id,d); return res.json({msg:'Transfert mis à jour'}); } const code=await generateUniqueCode(); await new Transfert({...d,code}).save(); res.json({msg:'Transfert créé'}); });
app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.params.id); res.json({msg:'Transfert supprimé'}); });
app.post('/transferts/retirer', requireLogin, async (req, res) => {
  try {
    const { id, mode } = req.body;

    // 1️⃣ Récupérer le transfert
    const transfert = await Transfert.findById(id);
    if (!transfert) {
      return res.status(404).json({ error: 'Transfert introuvable' });
    }

    if (transfert.retired) {
      return res.status(400).json({ error: 'Déjà retiré' });
    }

    const montantRetire = transfert.amount - transfert.fees;

    // 2️⃣ Trouver le stock correspondant
    const stock = await StockHistory.findOne({
      destination: transfert.destinationLocation,
      currency: transfert.currency
    });

    if (!stock) {
      return res.status(400).json({ error: 'Stock introuvable' });
    }

    if (stock.amount < montantRetire) {
      return res.status(400).json({ error: 'Stock insuffisant' });
    }

    // 3️⃣ Débiter le stock
    stock.amount = stock.amount - montantRetire;
    await stock.save();

    // 4️⃣ Marquer le transfert comme retiré
    transfert.retired = true;
    transfert.retraitHistory.push({
      date: new Date(),
      mode
    });
    await transfert.save();

    // 5️⃣ Historique
    // await new StockHistory({
     //  code: transfert.code,
       //action: 'RETRAIT',
       //stockId: stock._id,
       //sender: `${transfert.senderFirstName} ${transfert.senderLastName}`,
       //senderPhone: transfert.senderPhone,
       //destination: transfert.destinationLocation,
       //destinationPhone: transfert.receiverPhone,
       //amount: -montantRetire,
       //currency: transfert.currency
    // }).save();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});

// ================= CRUD STOCK =================
app.get('/stocks/get/:id', requireLogin, async(req,res)=>{ const s=await Stock.findById(req.params.id); res.json(s); });
app.post('/stocks/save', requireLogin, async(req,res)=>{ const d=req.body; if(d._id){ await Stock.findByIdAndUpdate(d._id,d); return res.json({msg:'Stock mis à jour'}); } const code=await generateUniqueCode(); await new Stock({...d,code}).save(); res.json({msg:'Stock créé'}); });
app.delete('/stocks/delete/:id', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.params.id); res.json({msg:'Stock supprimé'}); });

// ================= CRUD CLIENT =================
app.get('/clients/get/:id', requireLogin, async(req,res)=>{ const c=await Client.findById(req.params.id); res.json(c); });
app.post('/clients/save', requireLogin, async(req,res)=>{ const d=req.body; if(d._id){ await Client.findByIdAndUpdate(d._id,d); return res.json({msg:'Client mis à jour'}); } await new Client(d).save(); res.json({msg:'Client créé'}); });
app.delete('/clients/delete/:id', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.params.id); res.json({msg:'Client supprimé'}); });

// ================= CRUD RATE =================
app.get('/rates/get/:id', requireLogin, async(req,res)=>{ const r=await Rate.findById(req.params.id); res.json(r); });
app.post('/rates/save', requireLogin, async(req,res)=>{ const d=req.body; if(d._id){ await Rate.findByIdAndUpdate(d._id,d); return res.json({msg:'Taux mis à jour'}); } await new Rate(d).save(); res.json({msg:'Taux créé'}); });
app.delete('/rates/delete/:id', requireLogin, async(req,res)=>{ await Rate.findByIdAndDelete(req.params.id); res.json({msg:'Taux supprimé'}); });

// ================= EXPORT PDF =================
app.get('/export/pdf', requireLogin, async(req,res)=>{
  const {type}=req.query;
  let data=[], columns=[];
  if(type==='transfert'){ data=await Transfert.find(); columns=['Code','Origin','Expéditeur','Destination','Destinataire','Montant','Frais','Reçu','Devise']; }
  else if(type==='stock'){ data=await Stock.find(); columns=['Code','Expéditeur','Destination','Montant','Devise']; }
  else if(type==='client'){ data=await Client.find(); columns=['Nom','Prénom','Téléphone','Email','Vérifié']; }
  const doc = new PDFDocument({margin:30, size:'A4'}); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition','attachment; filename='+type+'.pdf'); doc.pipe(res);
  doc.fontSize(18).text(type.toUpperCase()+' LISTE', {align:'center'}); doc.moveDown();
  const tableTop=50; let y=tableTop;
  columns.forEach((col,i)=>{ doc.text(col, 50+i*100, y); });
  y+=20;
  data.forEach(d=>{
    columns.forEach((col,i)=>{
      let val='';
      if(type==='transfert'){ val={Code:d.code,Origin:d.originLocation,Expéditeur:d.senderFirstName,Destination:d.destinationLocation,Destinataire:d.receiverFirstName,Montant:d.amount,Frais:d.fees,Reçu:d.received,Devise:d.currency}[col]; }
      if(type==='stock'){ val={Code:d.code,Expéditeur:d.sender,Destination:d.destination,Montant:d.amount,Devise:d.currency}[col]; }
      if(type==='client'){ val={Nom:d.lastName,Prénom:d.firstName,Téléphone:d.phone,Email:d.email,Vérifié:d.kycVerified?'Oui':'Non'}[col]; }
      doc.text(val,50+i*100,y);
    }); y+=20;
  });
  doc.end();
});

// ================= SERVER =================
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
