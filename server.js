/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLETE READY FOR RENDER
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: true, saveUninitialized: true }));

/* ================= DATABASE ================= */
const MONGO_URI = process.env.MONGO_URI;
if(!MONGO_URI){ console.error("❌ MONGO_URI non défini !"); process.exit(1);}
mongoose.connect(MONGO_URI,{useNewUrlParser:true,useUnifiedTopology:true})
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{console.error(err); process.exit(1);});

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({username:String,password:String});
const User = mongoose.model('User',userSchema);

const transfertSchema = new mongoose.Schema({
  userType:String,
  senderFirstName:String,senderLastName:String,senderPhone:String,originLocation:String,
  receiverFirstName:String,receiverLastName:String,receiverPhone:String,destinationLocation:String,
  amount:Number,fees:Number,recoveryAmount:Number,currency:String,recoveryMode:String,
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  retraitHistory:[{date:Date,mode:String}],
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const stockSchema = new mongoose.Schema({
  location:String,currency:String,balance:{type:Number,default:0}
});
stockSchema.index({location:1,currency:1},{unique:true});
const Stock = mongoose.model('Stock',stockSchema);

/* ================= CONSTANTES ================= */
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];
const userTypes = ['Client','Distributeur','Administrateur','Agence de transfert'];

/* ================= UTILS ================= */
async function auth(req,res,next){if(req.session.user) return next(); res.redirect('/login');}
async function genCode(){let c; do{c=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);} while(await Transfert.findOne({code:c})); return c;}
async function getStock(location,currency){let s=await Stock.findOne({location,currency}); if(!s) s=await new Stock({location,currency,balance:0}).save(); return s;}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
.login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
.login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
.login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
.login-container button:hover{background:#e67300;}
</style></head>
<body>
<div class="login-container">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div></body></html>
`);});

app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let u=await User.findOne({username});
  if(!u) u=await new User({username,password:bcrypt.hashSync(password,10)}).save();
  if(!bcrypt.compareSync(password,u.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= FORMULAIRE TRANSFERT ================= */
app.get('/transferts/form',auth,async(req,res)=>{
  let t=null;
  if(req.query.code) t=await Transfert.findOne({code:req.query.code});
  const code=t?t.code:await genCode();
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
.container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
form{display:grid;gap:15px;}
label{font-weight:bold;margin-bottom:5px;display:block;}
input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
input[readonly]{background:#e9ecef;}
button{padding:15px;background:#ff8c42;color:white;font-weight:bold;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
button:hover{background:#e67300;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;}
.section-title{margin-top:20px;font-size:18px;color:#ff8c42;font-weight:bold;border-bottom:2px solid #ff8c42;padding-bottom:5px;}
</style>
</head><body>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<div class="section-title">Type de personne</div>
<select name="userType">${userTypes.map(u=>`<option ${t&&t.userType===u?'selected':''}>${u}</option>`).join('')}</select>
<div class="section-title">Expéditeur</div>
<div class="grid">
<div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
<div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
<div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
<div><label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
</div>
<div class="section-title">Destinataire</div>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
<div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
<div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
<div><label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
</div>
<div class="section-title">Montants & Devise</div>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
<div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
<div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
</div>
<div class="section-title">Mode de retrait</div>
<select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
<button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
</form>
<a href="/transferts/list">⬅ Retour liste</a>
<script>
const amountField=document.getElementById('amount');
const feesField=document.getElementById('fees');
const recoveryField=document.getElementById('recoveryAmount');
function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();
</script>
</div></body></html>
`);
});

app.post('/transferts/form',auth,async(req,res)=>{
  const amount=Number(req.body.amount||0);
  const fees=Number(req.body.fees||0);
  const recoveryAmount=amount-fees;
  const code=req.body.code||await genCode();
  let existing=await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount,retraitHistory:[],code}).save();
  res.redirect('/transferts/list');
});

/* ================= LISTE + RETRAIT + STOCK + DEPOT + EXPORT ================= */
app.get('/transferts/list',auth,async(req,res)=>{
  const search=req.query.search||'';
  const page=parseInt(req.query.page||1);
  const limit=20;
  let transferts=await Transfert.find().sort({createdAt:-1});
  transferts=transferts.filter(t=>t.code.toLowerCase().includes(search.toLowerCase())
    || t.senderFirstName.toLowerCase().includes(search.toLowerCase())
    || t.receiverFirstName.toLowerCase().includes(search.toLowerCase()));
  const totalPages=Math.ceil(transferts.length/limit);
  const paginated=transferts.slice((page-1)*limit,page*limit);

  // Totaux par ville/devise
  const totals={};
  for(let t of paginated){
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  }

  // HTML simplifié
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;}
  th{background:#ff8c42;color:white;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .retirer{background:#ff9900;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <form>
  <input type="text" id="search" placeholder="Recherche..." value="${search}">
  <button type="button" id="filterBtn">Filtrer</button>
  <a href="/logout">🚪 Déconnexion</a>
  </form>
  <h3>📊 Totaux par ville/devise</h3>
  <table><thead><tr><th>Ville</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Solde actuel</th></tr></thead><tbody>`;
  for(let dest in totals){
    for(let cur in totals[dest]){
      let s=await getStock(dest,cur);
      html+=`<tr><td>${dest}</td><td>${cur}</td><td>${totals[dest][cur].amount}</td><td>${totals[dest][cur].fees}</td><td>${totals[dest][cur].recovery}</td><td>${s.balance}</td></tr>`;
    }
  }
  html+=`</tbody></table>
  <h3>💰 Déposer du stock</h3>
  <form id="depositForm">
  <select name="location">${locations.map(l=>`<option>${l}</option>`).join('')}</select>
  <select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
  <input type="number" name="amount" placeholder="Montant à déposer" required>
  <button type="submit">Déposer</button>
  </form>
  <table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
  paginated.forEach(t=>{
    html+=`<tr data-id="${t._id}"><td>${t.code}</td><td>${t.userType}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td><td><button class="retirer">💰 Retirer</button></td></tr>`;
  });
  html+=`</tbody></table>
  <button id="exportPdf">📄 Export PDF</button>
  <button id="exportExcel">📊 Export Excel</button>
  <button id="exportWord">📝 Export Word</button>
  <script>
  async function postData(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return r.json();}
  document.getElementById('filterBtn').onclick=()=>{window.location='/transferts/list?search='+document.getElementById('search').value;}
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{
    const tr=btn.closest('tr'); const id=tr.dataset.id;
    const t=await postData('/retirer',{id});
    if(t.ok){tr.querySelector('td:nth-child(9)').innerText='Retiré';btn.remove();}
  });
  document.getElementById('depositForm').onsubmit=async e=>{e.preventDefault();
    const f=e.target; const data={location:f.location.value,currency:f.currency.value,amount:Number(f.amount.value)};
    const r=await postData('/deposit',data); if(r.ok){alert('Stock déposé'); f.amount.value=''; window.location.reload();}}
  document.getElementById('exportPdf').onclick=()=>window.location='/export/pdf';
  document.getElementById('exportExcel').onclick=()=>window.location='/export/excel';
  document.getElementById('exportWord').onclick=()=>window.location='/export/word';
  </script></body></html>`;
  res.send(html);
});

/* ================= RETRAIT ================= */
app.post('/retirer',auth,async(req,res)=>{
  const t=await Transfert.findById(req.body.id); if(!t) return res.send({ok:false});
  t.retired=true; t.retraitHistory.push({date:new Date(),mode:'Espèces'}); await t.save();
  const s=await getStock(t.destinationLocation,t.currency); s.balance-=t.recoveryAmount; await s.save();
  res.send({ok:true});
});

/* ================= DEPOT ================= */
app.post('/deposit',auth,async(req,res)=>{
  let s=await getStock(req.body.location,req.body.currency);
  s.balance+=Number(req.body.amount||0);
  await s.save();
  res.send({ok:true});
});

/* ================= EXPORT ================= */
app.get('/export/pdf',auth,async(req,res)=>{
  const transferts=await Transfert.find().sort({createdAt:-1});
  const doc=new PDFDocument({margin:30,size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts',{align:'center'}).moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code:${t.code} | Exp:${t.senderFirstName} ${t.senderLastName} | Dest:${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}`);
    doc.moveDown(0.3);
  });
  doc.end();
});

app.get('/export/excel',auth,async(req,res)=>{
  const transferts=await Transfert.find().sort({createdAt:-1});
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Transferts');
  sheet.columns=[
    {header:'Code',key:'code',width:10},
    {header:'Type',key:'type',width:15},
    {header:'Expéditeur',key:'sender',width:20},
    {header:'Destinataire',key:'receiver',width:20},
    {header:'Montant',key:'amount',width:10},
    {header:'Frais',key:'fees',width:10},
    {header:'Reçu',key:'recovery',width:10},
    {header:'Devise',key:'currency',width:10},
    {header:'Statut',key:'status',width:10},
  ];
  transferts.forEach(t=>{
    sheet.addRow({code:t.code,type:t.userType,sender:t.senderFirstName+' '+t.senderLastName,receiver:t.receiverFirstName+' '+t.receiverLastName,amount:t.amount,fees:t.fees,recovery:t.recoveryAmount,currency:t.currency,status:t.retired?'Retiré':'Non retiré'});
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res); res.end();
});

app.get('/export/word',auth,async(req,res)=>{
  const transferts=await Transfert.find().sort({createdAt:-1});
  let html=`<html><head><meta charset="UTF-8"></head><body><h2>Liste des transferts</h2><ul>`;
  transferts.forEach(t=>{
    html+=`<li>Code:${t.code} | Exp:${t.senderFirstName} ${t.senderLastName} | Dest:${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}</li>`;
  });
  html+='</ul></body></html>';
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename="transferts.doc"');
  res.send(html);
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur lancé sur le port ${PORT}`));
