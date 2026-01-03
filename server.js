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
  originLocation: { type: String, enum:['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'] },
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: { type: String, enum:['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'] },
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: { type: String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode: { type: String, enum:['ESPECE','TRANSFERT','VIREMENT','AUTRE'] },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  destinationFirstName: String,
  destinationLastName: String,
  destinationPhone: String,
  amount: Number,
  currency: { type: String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code: String,
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  destinationFirstName: String,
  destinationLastName: String,
  destinationPhone: String,
  amount: Number,
  currency: String,
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
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

function validPhone(phone){
  return /^00\d{9,12}$/.test(phone);
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/');
};

// =================== LOGIN ===================
app.get('/', (req,res)=>{
  res.send(`
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
  .login-container button:hover{background:#e67300;}
  </style>
  </head><body>
  <div class="login-container">
  <h2>Connexion</h2>
  <form method="post" action="/login">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Se connecter</button>
  </form>
  </div></body></html>
  `);
});

app.post('/login', async(req,res)=>{
  const {username,password}=req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role};
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/'));});

// =================== DASHBOARD ===================
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const stockHistory = await StockHistory.find().sort({date:-1});

  let html = `
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { font-family: Arial; background:#f0f2f5; margin:0; padding:20px; }
h2,h3,h4 { margin-top:20px; color:#333; }
a { color:#007bff; text-decoration:none; margin-right:10px; }
a:hover { text-decoration:underline; }
input, select, button { padding:8px; margin:5px 0; border-radius:6px; border:1px solid #ccc; font-size:14px; }
button { cursor:pointer; transition:0.3s; }
button.modify { background: #28a745; color:white; }
button.delete { background: #dc3545; color:white; }
button.retirer { background: #ff9900; color:white; }
button.print { background: #007bff; color:white; }
.table-container { width:100%; overflow-x:auto; margin-bottom:20px; }
table { border-collapse: collapse; width:100%; min-width:600px; }
th, td { border:1px solid #ccc; padding:10px; text-align:left; vertical-align:top; }
th { background:#ff8c42; color:white; }
@media(max-width:768px){
  table, thead, tbody, th, td, tr { display:block; }
  thead tr { display:none; }
  tr { margin-bottom:15px; border-bottom:2px solid #ddd; padding-bottom:10px; }
  td { border:none; position:relative; padding-left:50%; text-align:left; }
  td::before { content: attr(data-label); position:absolute; left:10px; top:10px; font-weight:bold; white-space:nowrap; }
}
</style>
</head><body>
<h2>📊 Dashboard</h2>
<a href="/logout">🚪 Déconnexion</a>
<button onclick="newTransfert()">➕ Nouveau Transfert</button>
<button onclick="newStock()">➕ Nouveau Stock</button>
<div class="table-container">
<h3>Transferts</h3>
<table>
<tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
`;

transferts.forEach(t=>{
  html+=`<tr>
<td data-label="Code">${t.code}</td>
<td data-label="Origine">${t.originLocation}</td>
<td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName}<br>📞 ${t.senderPhone}</td>
<td data-label="Destination">${t.destinationLocation}</td>
<td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName}<br>📞 ${t.receiverPhone}</td>
<td data-label="Montant">${t.amount}</td>
<td data-label="Frais">${t.fees}</td>
<td data-label="Reçu">${t.amount-t.fees}</td>
<td data-label="Devise">${t.currency}</td>
<td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
<td data-label="Actions">
<button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
<button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
<button class="print" onclick="printRow(this)">🖨️</button>
</td>
</tr>`;
});

html+=`</table></div>`;

// ================== Stocks ==================
html+=`<div class="table-container">
<h3>Stocks</h3>
<table>
<tr><th>Code</th><th>Expéditeur</th><th>Téléphone</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;

stocks.forEach(s=>{
  html+=`<tr>
<td data-label="Code">${s.code}</td>
<td data-label="Expéditeur">${s.senderFirstName} ${s.senderLastName}</td>
<td data-label="Téléphone">${s.senderPhone}</td>
<td data-label="Destination">${s.destinationFirstName} ${s.destinationLastName}<br>📞 ${s.destinationPhone}</td>
<td data-label="Montant">${s.amount}</td>
<td data-label="Devise">${s.currency}</td>
<td data-label="Actions">
<button class="modify" onclick="editStock('${s._id}')">✏️</button>
<button class="delete" onclick="deleteStock('${s._id}')">❌</button>
</td>
</tr>`;
});

html+=`</table></div>`;

// ================= SCRIPT ==================
html+=`<script>
function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}

function newTransfert(){
  let sender=prompt('Nom Expéditeur');
  if(!sender){alert('Champ obligatoire');return;}
  let senderPhone=prompt('Téléphone (ex: 00224627869461)');
  if(!/^00\\d{9,12}$/.test(senderPhone)){alert('Format téléphone invalide');return;}
  let origin=prompt('Origine (FRANCE, LABE, CONAKRY, SUISSE, BELGIQUE, ALLEMAGNE, USA)').toUpperCase();
  if(!['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'].includes(origin)){alert('Origine invalide');return;}
  let receiver=prompt('Nom Destinataire');
  let receiverPhone=prompt('Téléphone destinataire');
  if(!/^00\\d{9,12}$/.test(receiverPhone)){alert('Format téléphone invalide');return;}
  let dest=prompt('Destination (FRANCE, LABE, CONAKRY, SUISSE, BELGIQUE, ALLEMAGNE, USA)').toUpperCase();
  if(!['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'].includes(dest)){alert('Destination invalide');return;}
  let amount=parseFloat(prompt('Montant'));
  let fees=parseFloat(prompt('Frais'));
  let currency=prompt('Devise (GNF,XOF,EUR,USD)').toUpperCase();
  if(!['GNF','XOF','EUR','USD'].includes(currency)){alert('Devise invalide');return;}
  let mode=prompt('Mode de retrait (ESPECE,TRANSFERT,VIREMENT,AUTRE)').toUpperCase();
  if(!['ESPECE','TRANSFERT','VIREMENT','AUTRE'].includes(mode)){alert('Mode invalide');return;}
  postData('/transferts/form',{senderFirstName:sender,senderPhone,originLocation:origin,receiverFirstName:receiver,receiverPhone,destinationLocation:dest,amount,fees,recoveryAmount:amount-fees,currency,recoveryMode:mode,userType:'Client'}).then(()=>location.reload());
}

function editTransfert(id){
  fetch('/transferts/get/'+id).then(r=>r.json()).then(t=>{
    let sender=prompt('Nom Expéditeur',t.senderFirstName)||t.senderFirstName;
    let senderPhone=prompt('Téléphone',t.senderPhone)||t.senderPhone;
    if(!/^00\\d{9,12}$/.test(senderPhone)){alert('Format téléphone invalide');return;}
    let origin=prompt('Origine',t.originLocation).toUpperCase();
    if(!['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'].includes(origin)){alert('Origine invalide');return;}
    let receiver=prompt('Nom Destinataire',t.receiverFirstName)||t.receiverFirstName;
    let receiverPhone=prompt('Téléphone',t.receiverPhone)||t.receiverPhone;
    if(!/^00\\d{9,12}$/.test(receiverPhone)){alert('Format téléphone invalide');return;}
    let dest=prompt('Destination',t.destinationLocation).toUpperCase();
    if(!['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'].includes(dest)){alert('Destination invalide');return;}
    let amount=parseFloat(prompt('Montant',t.amount))||t.amount;
    let fees=parseFloat(prompt('Frais',t.fees))||t.fees;
    let currency=prompt('Devise',t.currency).toUpperCase();
    if(!['GNF','XOF','EUR','USD'].includes(currency)){alert('Devise invalide');return;}
    let mode=prompt('Mode de retrait',t.recoveryMode).toUpperCase();
    if(!['ESPECE','TRANSFERT','VIREMENT','AUTRE'].includes(mode)){alert('Mode invalide');return;}
    postData('/transferts/form',{_id:t._id,senderFirstName:sender,senderPhone,originLocation:origin,receiverFirstName:receiver,receiverPhone,destinationLocation:dest,amount,fees,recoveryAmount:amount-fees,currency,recoveryMode:mode}).then(()=>location.reload());
  });
}

function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){postData('/transferts/delete',{id}).then(()=>location.reload());}}
function retirerTransfert(id){let mode=prompt('Mode de retrait').toUpperCase();if(!['ESPECE','TRANSFERT','VIREMENT','AUTRE'].includes(mode)){alert('Mode invalide');return;}postData('/transferts/retirer',{id,mode}).then(()=>location.reload());}

function newStock(){
  let sender=prompt('Nom Expéditeur');
  let senderPhone=prompt('Téléphone (ex:00224627869461)');
  if(!/^00\\d{9,12}$/.test(senderPhone)){alert('Format téléphone invalide');return;}
  let dest=prompt('Nom Destinataire');
  let destPhone=prompt('Téléphone destinataire');
  if(!/^00\\d{9,12}$/.test(destPhone)){alert('Format téléphone invalide');return;}
  let amount=parseFloat(prompt('Montant'));
  let currency=prompt('Devise (GNF,XOF,EUR,USD)').toUpperCase();
  if(!['GNF','XOF','EUR','USD'].includes(currency)){alert('Devise invalide');return;}
  postData('/stocks/new',{senderFirstName:sender,senderPhone,destinationFirstName:dest,destinationPhone:destPhone,amount,currency}).then(()=>location.reload());
}

function editStock(id){
  fetch('/stocks/get/'+id).then(r=>r.json()).then(s=>{
    let sender=prompt('Nom Expéditeur',s.senderFirstName)||s.senderFirstName;
    let senderPhone=prompt('Téléphone',s.senderPhone)||s.senderPhone;
    if(!/^00\\d{9,12}$/.test(senderPhone)){alert('Format téléphone invalide');return;}
    let dest=prompt('Nom Destinataire',s.destinationFirstName)||s.destinationFirstName;
    let destPhone=prompt('Téléphone',s.destinationPhone)||s.destinationPhone;
    if(!/^00\\d{9,12}$/.test(destPhone)){alert('Format téléphone invalide');return;}
    let amount=parseFloat(prompt('Montant',s.amount))||s.amount;
    let currency=prompt('Devise',s.currency).toUpperCase();
    if(!['GNF','XOF','EUR','USD'].includes(currency)){alert('Devise invalide');return;}
    postData('/stocks/new',{_id:s._id,senderFirstName:sender,senderPhone,destinationFirstName:dest,destinationPhone:destPhone,amount,currency}).then(()=>location.reload());
  });
}

function deleteStock(id){if(confirm('Supprimer ce stock ?')){postData('/stocks/delete',{id}).then(()=>location.reload());}}

function printRow(btn){const row=btn.closest('tr');const newWin=window.open('');newWin.document.write('<html><head><title>Impression</title></head><body>');newWin.document.write('<table border="1" style="border-collapse:collapse; font-family:Arial;">');newWin.document.write(row.outerHTML);newWin.document.write('</table></body></html>');newWin.document.close();newWin.print();newWin.close();}
</script>
`;

html+=`</body></html>`;
res.send(html);
});

// ================= API POST ===================
// Transferts
app.post('/transferts/form', async(req,res)=>{
  let t;
  if(req.body._id){
    t=await Transfert.findById(req.body._id);
    Object.assign(t, req.body);
  } else {
    const code = await generateUniqueCode();
    t = new Transfert({...req.body, code});
  }
  await t.save();
  res.sendStatus(200);
});
app.post('/transferts/delete', async(req,res)=>{await Transfert.findByIdAndDelete(req.body.id);res.sendStatus(200);});
app.post('/transferts/retirer', async(req,res)=>{
  const t = await Transfert.findById(req.body.id);
  t.retired = true;
  t.retraitHistory.push({date:new Date(), mode:req.body.mode});
  await t.save();
  res.sendStatus(200);
});
app.get('/transferts/get/:id', async(req,res)=>{const t=await Transfert.findById(req.params.id);res.json(t);});

// Stocks
app.post('/stocks/new', async(req,res)=>{
  if(req.body._id){
    await Stock.findByIdAndUpdate(req.body._id,req.body);
  } else {
    const code = await generateUniqueCode();
    const s = new Stock({...req.body, code});
    await s.save();
  }
  res.sendStatus(200);
});
app.post('/stocks/delete', async(req,res)=>{await Stock.findByIdAndDelete(req.body.id);res.sendStatus(200);});
app.get('/stocks/get/:id', async(req,res)=>{const s=await Stock.findById(req.params.id);res.json(s);});

// =================== SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(\`🚀 Serveur lancé sur http://localhost:\${PORT}\`));
