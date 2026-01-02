/****************************************************************** 
 * APP TRANSFERT – VERSION TOUT-EN-UN COMPLETE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended:true }));
app.use(express.json());
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType:{ type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  sender:String, destination:String, amount:Number,
  currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ================= LOGIN =================
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

app.post('/login', async(req,res)=>{
  const { username,password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed=bcrypt.hashSync(password,10); user = await new Auth({ username,password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();

  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
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
    a{display:inline-block;margin-top:15px;color:#ff8c42;text-decoration:none;font-weight:bold;}
    a:hover{text-decoration:underline;}
  </style>
  </head><body>
  <div class="container">
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <div class="section-title">Type de personne</div>
      <select name="userType">
        <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
        <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
        <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
        <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
      </select>
      <div class="section-title">Expéditeur</div>
      <div class="grid">
        <div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
        <div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
        <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
        <div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="section-title">Destinataire</div>
      <div class="grid">
        <div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
        <div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
        <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
        <div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="section-title">Montants & Devise</div>
      <div class="grid">
        <div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
        <div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
        <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
        <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div><label>Code transfert</label><input type="text" name="code" readonly value="${t?t.code:code}"></div>
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
  </div>
  </body></html>`);
});

// ================= POST FORMULAIRE =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});

  let totals={};
  transferts.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
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
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <a href="/transferts/form">➕ Nouveau Transfert</a> | <a href="/transferts/stock">➕ Nouveau Stock</a> | <a href="/logout">🚪 Déconnexion</a>
  <h3>📊 Totaux par destination/devise</h3><table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
  for(let d in totals){
    for(let c in totals[d]){
      html+=`<tr><td>${d}</td><td>${c}</td><td>${totals[d][c].amount}</td><td>${totals[d][c].fees}</td><td>${totals[d][c].recovery}</td></tr>`;
    }
  }
  html+='</tbody></table>';

  html+='<table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  transferts.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}</td>
      <td>${t.amount}</td><td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <a href="/transferts/form?code=${t.code}"><button class="modify">✏️ Modifier</button></a>
        <button class="delete">❌ Supprimer</button>
        ${!t.retired?`<select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select><button class="retirer">💰 Retirer</button>`:''}
      </td>
    </tr>`;
  });
  html+='</tbody></table>';

  html+='<h3>📦 Stock</h3><table><thead><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr></thead><tbody>';
  stocks.forEach(s=>{html+=`<tr><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td><td>${s.currency}</td></tr>`;});
  html+='</tbody></table>';

  html+=`<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('❌ Confirmer?')){const tr=btn.closest('tr');await postData('/transferts/delete',{id:tr.dataset.id});tr.remove();}});
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');const mode=tr.querySelector('.retirementMode').value;await postData('/transferts/retirer',{id:tr.dataset.id,mode});tr.querySelector('td:nth-child(6)').innerText="Retiré";btn.remove();tr.querySelector('.retirementMode').remove();});
  </script></body></html>`;

  res.send(html);
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.send({ok:true});
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= STOCK =================
app.get('/transferts/stock', requireLogin, async(req,res)=>{
  const stocks = await Stock.find().sort({createdAt:-1});
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  input,select{padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;margin-bottom:10px;}
  button{padding:10px 15px;background:#ff8c42;color:white;border:none;border-radius:6px;cursor:pointer;}
  </style></head><body>
  <h2>➕ Nouveau Stock</h2>
  <form id="stockForm">
    <input name="sender" placeholder="Expéditeur" required>
    <input name="destination" placeholder="Destination" required>
    <input type="number" name="amount" placeholder="Montant" required>
    <select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
    <button>Enregistrer</button>
  </form>
  <h3>📦 Liste du stock</h3><table><thead><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr></thead><tbody>`;
  stocks.forEach(s=>{html+=`<tr><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td><td>${s.currency}</td></tr>`;});
  html+='</tbody></table>';
  html+=`<script>
  document.getElementById('stockForm').onsubmit=async(e)=>{e.preventDefault();const f=e.target;const data={sender:f.sender.value,destination:f.destination.value,amount:f.amount.value,currency:f.currency.value};await fetch('/transferts/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});window.location.reload();};
  </script></body></html>`;
  res.send(html);
});

app.post('/transferts/stock', requireLogin, async(req,res)=>{
  const { sender,destination,amount,currency } = req.body;
  await new Stock({sender,destination,amount,currency}).save();
  res.send({ok:true});
});

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
