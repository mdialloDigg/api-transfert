const express=require('express');
const mongoose=require('mongoose');
const session=require('express-session');
const bcrypt=require('bcryptjs');

const app=express();
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({secret:'transfert-secret-final',resave:false,saveUninitialized:true}));

mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté')).catch(console.error);

const locations=['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies=['GNF','EUR','USD','XOF'];
const retraitModes=['Espèces','Virement','Orange Money','Wave'];

const transfertSchema=new mongoose.Schema({
  userType:{type:String,enum:['Client','Distributeur','Administrateur','Agence de transfert'],required:true},
  senderFirstName:String,senderLastName:String,senderPhone:String,originLocation:String,
  receiverFirstName:String,receiverLastName:String,receiverPhone:String,destinationLocation:String,
  amount:Number,fees:Number,recoveryAmount:Number,currency:{type:String,enum:currencies,default:'GNF'},
  recoveryMode:String,retraitHistory:[{date:Date,mode:String}],retired:{type:Boolean,default:false},
  code:{type:String,unique:true},createdAt:{type:Date,default:Date.now}
});
const Transfert=mongoose.model('Transfert',transfertSchema);

const stockSchema=new mongoose.Schema({
  destinationLocation:String,currency:{type:String,enum:currencies},amount:{type:Number,default:0}
});
const Stock=mongoose.model('Stock',stockSchema);

const authSchema=new mongoose.Schema({username:String,password:String,role:{type:String,enum:['admin','agent'],default:'agent'}});
const Auth=mongoose.model('Auth',authSchema);

function setPermissions(username){
  if(username==='a') return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
  if(username==='admin2') return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}
const requireLogin=(req,res,next)=>{if(req.session.user)return next();res.redirect('/login');};
async function generateUniqueCode(){let code,exists=true;while(exists){code=String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(100+Math.random()*900);exists=await Transfert.findOne({code});}return code;}

// ===== LOGIN =====
app.get('/login',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
.login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
.login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
.login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
.login-container button:hover{background:#e67300;}
</style></head><body>
<div class="login-container"><h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form></div></body></html>`);});

app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let user=await Auth.findOne({username});
  if(!user){const hashed=bcrypt.hashSync(password,10);user=await new Auth({username,password:hashed}).save();}
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role,permissions:setPermissions(username)};
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});

// ===== FORM TRANSFERT =====
app.get('/transferts/form',requireLogin,async(req,res)=>{
  const t=req.query.code?await Transfert.findOne({code:req.query.code}):null;
  const code=t?t.code:await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
.container{max-width:900px;margin:auto;background:white;padding:20px;border-radius:15px;}
input,select{padding:12px;width:100%;margin-bottom:10px;}
button{padding:15px;width:100%;background:#ff8c42;color:white;border:none;border-radius:10px;cursor:pointer;}
</style></head><body>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<select name="userType">
<option ${t&&t.userType==='Client'?'selected':''}>Client</option>
<option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>
<input name="senderFirstName" placeholder="Expéditeur Prénom" value="${t?t.senderFirstName:''}" required>
<input name="senderLastName" placeholder="Expéditeur Nom" value="${t?t.senderLastName:''}" required>
<input name="senderPhone" placeholder="Expéditeur Téléphone" value="${t?t.senderPhone:''}" required>
<select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input name="receiverFirstName" placeholder="Destinataire Prénom" value="${t?t.receiverFirstName:''}" required>
<input name="receiverLastName" placeholder="Destinataire Nom" value="${t?t.receiverLastName:''}" required>
<input name="receiverPhone" placeholder="Destinataire Téléphone" value="${t?t.receiverPhone:''}" required>
<select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input type="number" name="amount" placeholder="Montant" value="${t?t.amount:''}" required>
<input type="number" name="fees" placeholder="Frais" value="${t?t.fees:''}" required>
<input type="text" name="recoveryAmount" placeholder="Reçu" value="${t?t.recoveryAmount:''}" readonly>
<select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
<select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
<input type="hidden" name="code" value="${code}">
<button>${t?'Modifier':'Enregistrer'}</button>
</form>
<a href="/transferts/list">⬅ Retour liste</a>
<script>
const amountField=document.querySelector('[name="amount"]');
const feesField=document.querySelector('[name="fees"]');
const recoveryField=document.querySelector('[name="recoveryAmount"]');
function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();
</script>
</div></body></html>`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
  const amount=Number(req.body.amount||0);
  const fees=Number(req.body.fees||0);
  const recoveryAmount=amount-fees;
  const code=req.body.code||await generateUniqueCode();
  let existing=await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount,retraitHistory:[],code}).save();
  res.redirect('/transferts/list');
});

// ===== LISTE AVEC RECHERCHE ET TOTAUX =====
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const search=req.query.search?.toLowerCase()||'';
  let transferts=await Transfert.find().sort({createdAt:-1});
  transferts=transferts.filter(t=>{
    return t.code.toLowerCase().includes(search)
    || t.senderFirstName.toLowerCase().includes(search)
    || t.senderLastName.toLowerCase().includes(search)
    || t.senderPhone.toLowerCase().includes(search)
    || t.receiverFirstName.toLowerCase().includes(search)
    || t.receiverLastName.toLowerCase().includes(search)
    || t.receiverPhone.toLowerCase().includes(search);
  });
  const totals={};
  transferts.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={retire:0,non:0};
    if(t.retired) totals[t.destinationLocation][t.currency].retire+=t.amount;
    else totals[t.destinationLocation][t.currency].non+=t.amount;
  });
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
th{background:#ff8c42;color:white;}
.retired{background:#fff3b0;}
button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
.modify{background:#28a745;}
.delete{background:#dc3545;}
.retirer{background:#ff9900;}
.imprimer{background:#17a2b8;}
a{margin-right:10px;text-decoration:none;color:#007bff;}
</style></head><body>
<h2>📋 Liste des transferts</h2>
<form method="get">
<input type="text" name="search" placeholder="Recherche..." value="${req.query.search||''}">
<button>🔍 Filtrer</button>
</form>
<a href="/transferts/form">➕ Nouveau Transfert</a>
<a href="/stock/form">➕ Ajout Stock</a>
<h3>📊 Totaux par destination/devise</h3>
<table><thead><tr><th>Destination</th><th>Devise</th><th>Non Retiré</th><th>Retiré</th></tr></thead><tbody>`;
for(let dest in totals) for(let cur in totals[dest]){
  html+=`<tr><td>${dest}</td><td>${cur}</td><td>${totals[dest][cur].non}</td><td>${totals[dest][cur].retire}</td></tr>`;
}
html+='</tbody></table><table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
transferts.forEach(t=>{
  html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
<td>${t.code}</td><td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
<td>${t.originLocation}</td>
<td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
<td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td>
<td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<button class="modify" onclick="window.location.href='/transferts/form?code=${t.code}'">✏️ Modifier</button>
<button class="delete">❌ Supprimer</button>
${!t.retired?`<select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select><button class="retirer">💰 Retirer</button>`:''}
<button class="imprimer" onclick="window.open('/transferts/print/${t._id}','_blank')">🖨 Imprimer</button>
</td></tr>`;
});
html+=`</tbody></table>
<script>
async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('❌ Confirmer?')){const tr=btn.closest('tr');await postData('/transferts/delete',{id:tr.dataset.id});tr.remove();}});
document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');const mode=tr.querySelector('.retirementMode').value;await postData('/transferts/retirer',{id:tr.dataset.id,mode});tr.querySelector('td:nth-child(10)').innerText="Retiré";btn.remove();tr.querySelector('.retirementMode').remove();});
</script></body></html>`;
res.send(html);
});

// ===== RETRAIT =====
app.post('/transferts/retirer',requireLogin,async(req,res)=>{
  const t=await Transfert.findById(req.body.id);
  if(!t) return res.status(404).send({error:'Transfert introuvable'});
  let s=await Stock.findOne({destinationLocation:t.destinationLocation,currency:t.currency});
  if(!s||s.amount<t.amount) return res.status(400).send({error:'Stock insuffisant'});
  s.amount-=t.amount; await s.save();
  t.retired=true; t.recoveryMode=req.body.mode; t.retraitHistory.push({date:new Date(),mode:req.body.mode});
  await t.save(); res.send({ok:true});
});

// ===== SUPPRESSION =====
app.post('/transferts/delete',requireLogin,async(req,res)=>{await Transfert.findByIdAndDelete(req.body.id);res.send({ok:true});});

// ===== STOCK FORM =====
app.get('/stock/form',requireLogin,(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
.container{max-width:500px;margin:auto;background:white;padding:20px;border-radius:10px;}
input,select{padding:10px;margin-bottom:10px;width:100%;}
button{padding:10px;width:100%;background:#ff8c42;color:white;border:none;border-radius:5px;cursor:pointer;}
</style></head><body>
<div class="container">
<h2>➕ Ajout Stock</h2>
<label>Destination</label><select id="destination">${locations.map(v=>`<option>${v}</option>`).join('')}</select>
<label>Devise</label><select id="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
<label>Montant</label><input type="number" id="amount" value="0">
<button onclick="ajouterStock()">Ajouter</button>
<a href="/transferts/list"><button style="background:#007bff;margin-top:10px;">⬅ Retour liste</button></a>
<div id="message" style="margin-top:10px;color:green;"></div>
<script>
async function ajouterStock(){
const dest=document.getElementById('destination').value;
const curr=document.getElementById('currency').value;
const amt=parseFloat(document.getElementById('amount').value);
if(!amt||amt<=0) return alert('Montant invalide');
const res=await fetch('/stock/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationLocation:dest,currency:curr,amount:amt})});
const data=await res.json();
if(data.ok){document.getElementById('message').innerText='✅ Stock ajouté';document.getElementById('amount').value=0;}else{document.getElementById('message').innerText='❌ '+data.error;}
}
</script>
</div></body></html>`);
});

app.post('/stock/add',requireLogin,async(req,res)=>{
  let {destinationLocation,currency,amount}=req.body;
  amount=Number(amount)||0;if(amount<=0) return res.send({ok:false,error:'Montant invalide'});
  let s=await Stock.findOne({destinationLocation,currency});
  if(!s) s=new Stock({destinationLocation,currency,amount});
  else s.amount+=amount;
  await s.save();
  res.send({ok:true});
});

// ===== IMPRESSION =====
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t=await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body style="font-family:Arial;text-align:center;">
<div style="border:1px dashed #333;padding:10px;width:280px;margin:auto;">
<h3>💰 Transfert</h3>
<p>Code: ${t.code}</p>
<p>Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
<p>Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
<p>Montant: ${t.amount} ${t.currency}</p>
<p>Frais: ${t.fees}</p>
<p>Reçu: ${t.recoveryAmount}</p>
<p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
</div>
<button onclick="window.print()">🖨 Imprimer</button>
</body></html>`);
});

app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
