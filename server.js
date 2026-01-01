const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({secret:'transfert-secret-final',resave:false,saveUninitialized:true}));

// ====== DB ======
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté')).catch(console.error);

// ====== Schemas ======
const transfertSchema = new mongoose.Schema({
  userType:{type:String,enum:['Client','Distributeur','Administrateur','Agence de transfert'],required:true},
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{type:String,enum:['GNF','EUR','USD','XOF'],default:'GNF'},
  recoveryMode:String, retraitHistory:[{date:Date,mode:String}], retired:{type:Boolean,default:false},
  code:{type:String,unique:true}, createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  destinationLocation:String,
  currency:{type:String,enum:['GNF','EUR','USD','XOF']},
  amount:{type:Number,default:0}
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({
  username:String, password:String, role:{type:String,enum:['admin','agent'],default:'agent'}
});
const Auth = mongoose.model('Auth', authSchema);

// ====== Utils ======
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter=String.fromCharCode(65+Math.floor(Math.random()*26));
    const number=Math.floor(100+Math.random()*900);
    code=`${letter}${number}`;
    exists=await Transfert.findOne({code}).exec();
  }
  return code;
}

// ====== Auth ======
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ====== Login ======
app.get('/login',(req,res)=>{res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
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
</div></body></html>`);});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role,permissions:setPermissions(username)};
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ====== Form Transfert ======
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t?t.code:await generateUniqueCode();
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

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ====== Liste Transferts AJAX ======
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <div>
    <input type="text" id="searchInput" placeholder="Recherche...">
    <select id="statusSelect"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
    <a href="/transferts/form"><button style="background:#ff8c42;color:white;">➕ Nouveau</button></a>
    <a href="/stock/form"><button style="background:#28a745;color:white;">➕ Ajout Stock</button></a>
    <a href="/logout"><button>🚪 Déconnexion</button></a>
  </div>
  <div id="totaux"></div>
  <table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Reçu</th><th>Devise</th><th>Destination</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="transfertsBody"></tbody></table>
  <div id="pagination"></div>
  <script>
  const searchInput = document.querySelector('#searchInput');
  const statusSelect = document.querySelector('#statusSelect');
  const tableBody = document.querySelector('#transfertsBody');
  const totalsDiv = document.querySelector('#totaux');
  const paginationDiv = document.querySelector('#pagination');

  async function loadTransferts(search='', status='all', page=1){
    const res = await fetch('/transferts/list?ajax=1&search='+encodeURIComponent(search)+'&status='+status+'&page='+page);
    const data = await res.json();
    tableBody.innerHTML='';
    data.transferts.forEach(t=>{
      const tr=document.createElement('tr');
      tr.className=t.retired?'retired':'';
      tr.innerHTML='<td>'+t.code+'</td><td>'+t.senderFirstName+' '+t.senderLastName+'</td><td>'+t.receiverFirstName+' '+t.receiverLastName+'</td><td>'+t.recoveryAmount+'</td><td>'+t.currency+'</td><td>'+t.destinationLocation+'</td><td>'+(t.retired?'✅':'❌')+'</td><td>'+
      (!t.retired?'<button onclick="retirer(\\''+t._id+'\\')">Retirer</button>':'')+
      '<a href="/transferts/form?code='+t.code+'"><button>Modifier</button></a>'+
      '<button onclick="supprimer(\\''+t._id+'\\')">Supprimer</button>'+
      '<a href="/transferts/print/'+t._id+'" target="_blank"><button>🖨</button></a></td>';
      tableBody.appendChild(tr);
    });

    totalsDiv.innerHTML='<h3>Totaux par destination/devise</h3><table border="1"><tr><th>Destination</th><th>Devise</th><th>Non Retiré</th><th>Retiré</th></tr>'+
      Object.keys(data.totals).map(dest=>Object.keys(data.totals[dest]).map(curr=>'<tr><td>'+dest+'</td><td>'+curr+'</td><td>'+data.totals[dest][curr].nonRetire+'</td><td>'+data.totals[dest][curr].retire+'</td></tr>').join('')).join('')+'</table>';

    paginationDiv.innerHTML='';
    for(let i=1;i<=data.totalPages;i++){
      const a=document.createElement('a');
      a.href="#"; a.innerText=i;
      a.onclick=e=>{ e.preventDefault(); loadTransferts(searchInput.value,statusSelect.value,i); };
      paginationDiv.appendChild(a);
      paginationDiv.appendChild(document.createTextNode(' '));
    }
  }

  async function retirer(id){
    const mode=prompt('Mode de retrait (Espèces,Virement,Orange Money,Wave)');
    if(!mode)return;
    const res=await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
    const data=await res.json();
    if(data.ok) loadTransferts(searchInput.value,statusSelect.value); else alert(data.error||'Erreur');
  }

  async function supprimer(id){
    if(!confirm('Confirmer suppression?')) return;
    await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    loadTransferts(searchInput.value,statusSelect.value);
  }

  searchInput.oninput=()=>loadTransferts(searchInput.value,statusSelect.value);
  statusSelect.onchange=()=>loadTransferts(searchInput.value,statusSelect.value);
  loadTransferts();
  </script>
  </body></html>`;
  if(req.query.ajax) {
    // JSON pour AJAX
    const { search='', status='all', page=1 } = req.query;
    let transferts = await Transfert.find().sort({createdAt:-1});
    const s = search.toLowerCase();
    transferts = transferts.filter(t => t.code.toLowerCase().includes(s)||t.senderFirstName.toLowerCase().includes(s)||t.senderLastName.toLowerCase().includes(s)||t.receiverFirstName.toLowerCase().includes(s)||t.receiverLastName.toLowerCase().includes(s));
    if(status==='retire') transferts = transferts.filter(t=>t.retired);
    else if(status==='non') transferts = transferts.filter(t=>!t.retired);
    const limit=20;
    const totalPages=Math.ceil(transferts.length/limit);
    const paginated=transferts.slice((page-1)*limit,page*limit);
    const totals={};
    paginated.forEach(t=>{
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={retire:0,nonRetire:0};
      if(t.retired) totals[t.destinationLocation][t.currency].retire+=t.recoveryAmount;
      else totals[t.destinationLocation][t.currency].nonRetire+=t.recoveryAmount;
    });
    return res.json({transferts:paginated,totals,page:Number(page),totalPages});
  }
  res.send(html);
});

// ====== POST Retrait ======
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.body.id);
  if(!t) return res.status(404).send({error:'Transfert introuvable'});
  let s = await Stock.findOne({destinationLocation:t.destinationLocation,currency:t.currency});
  if(!s || s.amount<t.amount) return res.status(400).send({error:'Stock insuffisant'});
  s.amount -= t.amount; await s.save();
  t.retired=true; t.recoveryMode=req.body.mode; t.retraitHistory.push({date:new Date(),mode:req.body.mode});
  await t.save(); res.send({ok:true});
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.send({ok:true}); });

// ====== Form Ajout Stock ======
app.get('/stock/form', requireLogin, (req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f0f4f8;padding:20px;}
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
    if(!amt || amt<=0) return alert('Montant invalide');
    const res=await fetch('/stock/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({destinationLocation:dest,currency:curr,amount:amt})});
    const data=await res.json();
    if(data.ok){ document.getElementById('message').innerText='✅ Stock ajouté'; document.getElementById('amount').value=0; } else { document.getElementById('message').innerText='❌ '+data.error; }
  }
  </script>
  </div></body></html>`);
});

app.post('/stock/add', requireLogin, async(req,res)=>{
  let {destinationLocation,currency,amount} = req.body;
  amount = Number(amount)||0; if(amount<=0) return res.send({ok:false,error:'Montant invalide'});
  let s = await Stock.findOne({destinationLocation,currency});
  if(!s) s = new Stock({destinationLocation,currency,amount});
  else s.amount += amount;
  await s.save();
  res.send({ok:true});
});

app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
