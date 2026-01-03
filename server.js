require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'transfert-secret-final', resave: false, saveUninitialized: true }));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(err=>{console.error(err.message); process.exit(1);});

const transfertSchema = new mongoose.Schema({
  userType:String, senderFirstName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:String, recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code:{ type:String, unique:true }, sender:String, senderPhone:String,
  destination:String, destinationPhone:String, amount:Number, currency:String,
  createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{ type:String, enum:['admin','agent'], default:'agent' } });
const Auth = mongoose.model('Auth', authSchema);

async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter=String.fromCharCode(65+Math.floor(Math.random()*26));
    const number=Math.floor(100+Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{if(req.session.user) return next(); res.redirect('/login');};

// LOGIN
app.get('/login',(req,res)=>{
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Login</title></head>
  <body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:Arial;">
  <form method="post" style="display:flex;flex-direction:column;width:300px;">
  <input name="username" placeholder="Utilisateur" required style="margin:5px;padding:10px;font-size:16px;">
  <input type="password" name="password" placeholder="Mot de passe" required style="margin:5px;padding:10px;font-size:16px;">
  <button style="margin:5px;padding:10px;background:#28a745;color:white;border:none;font-size:16px;">Se connecter</button>
  </form></body></html>`);
});

app.post('/login', async(req,res)=>{
  const {username,password}=req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={ username:user.username, role:user.role };
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// DASHBOARD
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard Transferts & Stocks</title>
<style>
body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
h2{color:#333;}
a{margin-right:10px;color:#007bff;text-decoration:none;}
a:hover{text-decoration:underline;}
input,select,button{padding:8px;margin:5px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;}
button{cursor:pointer;}
button.modify{background:#28a745;color:white;}
button.delete{background:#dc3545;color:white;}
button.retirer{background:#ff9900;color:white;}
button.print{background:#007bff;color:white;}
.table-container{width:100%;overflow-x:auto;margin-bottom:20px;}
table{border-collapse:collapse;width:100%;min-width:600px;}
th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top;}
th{background:#ff8c42;color:white;}
@media(max-width:768px){
  table,thead,tbody,th,td,tr{display:block;}
  thead tr{display:none;}
  tr{margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px;}
  td{border:none;position:relative;padding-left:50%;text-align:left;}
  td::before{content: attr(data-label);position:absolute;left:10px;top:10px;font-weight:bold;}
}
</style>
</head>
<body>
<h2>Dashboard</h2>
<a href="/logout">Déconnexion</a>
<h3>Transferts</h3>
<button onclick="newTransfert()">➕ Nouveau Transfert</button>
<div class="table-container"><table>
<tr><th>Code</th><th>Origin</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
${transferts.map(t=>`<tr data-id="${t._id}">
<td data-label="Code">${t.code}</td>
<td data-label="Origin">${t.originLocation}</td>
<td data-label="Expéditeur">${t.senderFirstName}<br>${t.senderPhone||'-'}</td>
<td data-label="Destination">${t.destinationLocation}</td>
<td data-label="Destinataire">${t.receiverFirstName}<br>${t.receiverPhone||'-'}</td>
<td data-label="Montant">${t.amount}</td>
<td data-label="Frais">${t.fees}</td>
<td data-label="Reçu">${t.amount-t.fees}</td>
<td data-label="Devise">${t.currency}</td>
<td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
<td data-label="Actions">
<button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
<button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
</td></tr>`).join('')}
</table></div>
<h3>Stocks</h3>
<button onclick="newStock()">➕ Nouveau Stock</button>
<div class="table-container"><table>
<tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>
${stocks.map(s=>`<tr data-id="${s._id}">
<td data-label="Code">${s.code}</td>
<td data-label="Expéditeur">${s.sender}<br>${s.senderPhone||'-'}</td>
<td data-label="Destination">${s.destination}<br>${s.destinationPhone||'-'}</td>
<td data-label="Montant">${s.amount}</td>
<td data-label="Devise">${s.currency}</td>
<td data-label="Actions">
<button class="modify" onclick="editStock('${s._id}')">✏️</button>
<button class="delete" onclick="deleteStock('${s._id}')">❌</button>
</td></tr>`).join('')}
</table></div>

<script>
async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
function normalizeUpper(v){return (v||'').toString().trim().toUpperCase();}
const ALLOWED_CURRENCIES=['GNF','XOF','EUR','USD'];
const ALLOWED_LOCATIONS=['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'];
const ALLOWED_RETRAIT_MODES=['ESPECE','TRANSFERT','VIREMENT','AUTRE'];
function isValidPhone(p){return /^00224\\d{9}$/.test(p)||/^0033\\d{9}$/.test(p);}

async function newTransfert(){
let origin=normalizeUpper(prompt('Origine')); if(!ALLOWED_LOCATIONS.includes(origin)){alert('Origine invalide');return;}
let sender=prompt('Nom expéditeur'); if(!sender){alert('Nom obligatoire');return;}
let senderPhone=prompt('Téléphone expéditeur'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
let destination=normalizeUpper(prompt('Destination')); if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
let receiver=prompt('Nom destinataire'); if(!receiver){alert('Nom obligatoire');return;}
let receiverPhone=prompt('Téléphone destinataire'); if(!isValidPhone(receiverPhone)){alert('Téléphone invalide');return;}
let amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
let fees=parseFloat(prompt('Frais')); if(isNaN(fees)||fees<0){alert('Frais invalide');return;}
let currency=normalizeUpper(prompt('Devise','GNF')); if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
let recoveryMode=normalizeUpper(prompt('Mode retrait','ESPECE')); if(!ALLOWED_RETRAIT_MODES.includes(recoveryMode)){alert('Mode invalide');return;}
await postData('/transferts/form',{userType:'Client',originLocation:origin,senderFirstName:sender,senderPhone,destinationLocation:destination,receiverFirstName:receiver,receiverPhone,amount,fees,recoveryAmount:amount-fees,currency,recoveryMode});
location.reload();
}
async function editTransfert(id){const t=await (await fetch('/transferts/get/'+id)).json();await newTransfert();}
async function deleteTransfert(id){if(confirm('Supprimer ce transfert?')){await postData('/transferts/delete',{id});location.reload();}}
async function retirerTransfert(id){let mode=normalizeUpper(prompt('Mode retrait','ESPECE'));await postData('/transferts/retirer',{id,mode});location.reload();}

async function newStock(){let sender=prompt('Expéditeur');if(!sender){alert('Nom obligatoire');return;}
let senderPhone=prompt('Téléphone expéditeur');if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
let destination=normalizeUpper(prompt('Destination'));if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
let destinationPhone=prompt('Téléphone destinataire');if(!isValidPhone(destinationPhone)){alert('Téléphone invalide');return;}
let amount=parseFloat(prompt('Montant'));if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
let currency=normalizeUpper(prompt('Devise','GNF'));if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
await postData('/stocks/new',{sender,senderPhone,destination,destinationPhone,amount,currency});location.reload();}
async function editStock(id){await newStock();}
async function deleteStock(id){if(confirm('Supprimer ce stock ?')){await postData('/stocks/delete',{id});location.reload();}}
</script>
</body></html>`);
});

// TRANSFERT CRUD
app.post('/transferts/form', requireLogin, async(req,res)=>{const d=req.body;if(d._id) await Transfert.findByIdAndUpdate(d._id,{...d}); else {const code= d.code||await generateUniqueCode(); await new Transfert({...d,code,retraitHistory:[]}).save();}res.json({ok:true});});
app.post('/transferts/delete', requireLogin, async(req,res)=>{await Transfert.findByIdAndDelete(req.body.id);res.json({ok:true});});
app.post('/transferts/retirer', requireLogin, async(req,res)=>{const {id,mode}=req.body; const t=await Transfert.findById(id); t.retired=true; t.retraitHistory.push({date:new Date(),mode}); await t.save();res.json({ok:true});});
app.get('/transferts/get/:id', requireLogin, async(req,res)=>{const t=await Transfert.findById(req.params.id);res.json(t);});

// STOCK CRUD
app.post('/stocks/new', requireLogin, async(req,res)=>{const d=req.body;if(d._id) await Stock.findByIdAndUpdate(d._id,{...d}); else {const code=d.code||await generateUniqueCode(); await new Stock({...d,code}).save();}res.json({ok:true});});
app.post('/stocks/delete', requireLogin, async(req,res)=>{await Stock.findByIdAndDelete(req.body.id);res.json({ok:true});});
app.get('/stocks/get/:id', requireLogin, async(req,res)=>{const s=await Stock.findById(req.params.id);res.json(s);});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
