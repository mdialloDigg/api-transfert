/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN AVEC LISTE AJAX
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
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

// ================= STOCK =================
const stockSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  destination: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);




// ================= UTIL =================
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
      <form method="post">
        <input name="username" placeholder="Utilisateur" required>
        <input type="password" name="password" placeholder="Mot de passe" required>
        <button>Se connecter</button>
      </form>
    </div>
  </body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||''; const status = req.query.status||'all';

  res.send(`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial,sans-serif;background:#f0f4f8;margin:0;padding:10px;}
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
      <input type="hidden" name="_search" value="${search}">
      <input type="hidden" name="_status" value="${status}">
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
        <div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
      </div>
      <div class="section-title">Mode de retrait</div>
      <select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/transferts/list?search=${encodeURIComponent(search)}&status=${status}">⬅ Retour liste</a>
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
  res.redirect(`/transferts/list?search=${encodeURIComponent(req.body._search||'')}&status=${req.body._status||'all'}`);
});

// ================= LISTE TRANSFERTS AVEC AJAX =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  const limit=20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);

  // Totaux par destination/devise
  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // HTML avec AJAX pour suppression et retrait
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
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
  <div id="totaux"><h3>📊 Totaux par destination/devise</h3><table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
  for(let dest in totals){
    for(let curr in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html+='</tbody></table></div>';
  
  html+=`<form id="filterForm"><input type="text" name="search" placeholder="Recherche..." value="${search}">
  <select name="status">
    <option value="all" ${status==='all'?'selected':''}>Tous</option>
    <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
    <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
  </select>
  <button type="submit">🔍 Filtrer</button>
  ${req.session.user.permissions.ecriture?'<a href="/transferts/form">➕ Nouveau</a>':''}
  ${req.session.user.permissions.ecriture?'<a href="/transferts/stock">➕ Nouveau Stock</a>':''}
  <a href="/transferts/pdf">📄 PDF</a><a href="/transferts/excel">📊 Excel</a><a href="/transferts/word">📝 Word</a>
  <a href="/logout">🚪 Déconnexion</a></form>`;

  html+='<table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  paginated.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td>
      <td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        ${req.session.user.permissions.modification?`<a href="/transferts/form?code=${t.code}&search=${search}&status=${status}"><button class="modify">✏️ Modifier</button></a>`:''}
        ${req.session.user.permissions.suppression?`<button class="delete">❌ Supprimer</button>`:''}
        ${req.session.user.permissions.retrait && !t.retired?`<select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select><button class="retirer">💰 Retirer</button>`:''}
        ${req.session.user.permissions.imprimer?`<a href="/transferts/print/${t._id}" target="_blank"><button class="imprimer">🖨 Imprimer</button></a>`:''}
      </td>
    </tr>`;
  });
  html+='</tbody></table>';
  html+='<div id="pagination">';
  for(let i=1;i<=totalPages;i++) html+=`<a href="#" class="page" data-page="${i}">${i}</a> `;
  html+='</div>';

  html+=`<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('❌ Confirmer?')){const tr=btn.closest('tr');await postData('/transferts/delete',{id:tr.dataset.id});tr.remove();}});
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');const mode=tr.querySelector('.retirementMode').value;await postData('/transferts/retirer',{id:tr.dataset.id,mode});tr.querySelector('td:nth-child(10)').innerText="Retiré";btn.remove();tr.querySelector('.retirementMode').remove();});
  document.getElementById('filterForm').onsubmit=async(e)=>{e.preventDefault();const f=e.target;const s=f.search.value;const st=f.status.value;window.location.href='/transferts/list?search='+encodeURIComponent(s)+'&status='+st;};
  document.querySelectorAll('.page').forEach(p=>p.onclick=e=>{e.preventDefault();const page=p.dataset.page;window.location.href='/transferts/list?search=${encodeURIComponent(search)}&status=${status}&page='+page;});
  </script>`;
  html+='</body></html>';
  res.send(html);
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.send({ok:true});
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;text-align:center;padding:10px;}
  .ticket{border:1px dashed #333;padding:10px;width:280px;margin:auto;}
  h3{margin:5px 0;}p{margin:3px 0;font-size:14px;}
  button{margin-top:5px;padding:5px 10px;}
  </style></head><body>
  <div class="ticket">
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

// ================= LISTE TRANSFERTS AVEC AJAX =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  const limit=20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);

  // Totaux par destination/devise
  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // HTML avec AJAX pour suppression et retrait
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
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
  <div id="totaux"><h3>📊 Totaux par destination/devise</h3><table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
  for(let dest in totals){
    for(let curr in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html+='</tbody></table></div>';
  
  html+=`<form id="filterForm"><input type="text" name="search" placeholder="Recherche..." value="${search}">
  <select name="status">
    <option value="all" ${status==='all'?'selected':''}>Tous</option>
    <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
    <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
  </select>
  <button type="submit">🔍 Filtrer</button>
  ${req.session.user.permissions.ecriture?'<a href="/transferts/form">➕ Nouveau</a>':''}
  <a href="/transferts/pdf">📄 PDF</a><a href="/transferts/excel">📊 Excel</a><a href="/transferts/word">📝 Word</a>
  <a href="/logout">🚪 Déconnexion</a></form>`;

  html+='<table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  paginated.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td>
      <td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        ${req.session.user.permissions.modification?`<a href="/transferts/form?code=${t.code}&search=${search}&status=${status}"><button class="modify">✏️ Modifier</button></a>`:''}
        ${req.session.user.permissions.suppression?`<button class="delete">❌ Supprimer</button>`:''}
        ${req.session.user.permissions.retrait && !t.retired?`<select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select><button class="retirer">💰 Retirer</button>`:''}
        ${req.session.user.permissions.imprimer?`<a href="/transferts/print/${t._id}" target="_blank"><button class="imprimer">🖨 Imprimer</button></a>`:''}
      </td>
    </tr>`;
  });
  html+='</tbody></table>';
  html+='<div id="pagination">';
  for(let i=1;i<=totalPages;i++) html+=`<a href="#" class="page" data-page="${i}">${i}</a> `;
  html+='</div>';

  html+=`<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('❌ Confirmer?')){const tr=btn.closest('tr');await postData('/transferts/delete',{id:tr.dataset.id});tr.remove();}});
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');const mode=tr.querySelector('.retirementMode').value;await postData('/transferts/retirer',{id:tr.dataset.id,mode});tr.querySelector('td:nth-child(10)').innerText="Retiré";btn.remove();tr.querySelector('.retirementMode').remove();});
  document.getElementById('filterForm').onsubmit=async(e)=>{e.preventDefault();const f=e.target;const s=f.search.value;const st=f.status.value;window.location.href='/transferts/list?search='+encodeURIComponent(s)+'&status='+st;};
  document.querySelectorAll('.page').forEach(p=>p.onclick=e=>{e.preventDefault();const page=p.dataset.page;window.location.href='/transferts/list?search=${encodeURIComponent(search)}&status=${status}&page='+page;});
  </script>`;
  html+='</body></html>';
  res.send(html);
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.send({ok:true});
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});


// ================= EXPORT PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const doc = new PDFDocument({ margin:30, size:'A4' });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts', {align:'center'}).moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code:${t.code} | Exp:${t.senderFirstName} ${t.senderLastName} | Dest:${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}`);
    doc.moveDown(0.3);
  });
  doc.end();
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns=[
    {header:'Code',key:'code',width:15},{header:'Type',key:'userType',width:20},
    {header:'Expéditeur',key:'sender',width:30},{header:'Origine',key:'originLocation',width:15},
    {header:'Destinataire',key:'receiver',width:30},{header:'Destination',key:'destinationLocation',width:15},
    {header:'Montant',key:'amount',width:12},{header:'Frais',key:'fees',width:12},{header:'Reçu',key:'recoveryAmount',width:12},
    {header:'Devise',key:'currency',width:10},{header:'Statut',key:'status',width:12},{header:'Date',key:'createdAt',width:20}
  ];
  transferts.forEach(t=>{sheet.addRow({code:t.code,userType:t.userType,sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,originLocation:t.originLocation,receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,destinationLocation:t.destinationLocation,amount:t.amount,fees:t.fees,recoveryAmount:t.recoveryAmount,currency:t.currency,status:t.retired?'Retiré':'Non retiré',createdAt:t.createdAt.toLocaleString()});});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res); res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html='<html><head><meta charset="UTF-8"><title>Transferts</title></head><body><h2>Liste des transferts</h2><table border="1" cellspacing="0" cellpadding="5"><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Statut</th><th>Date</th></tr>';
  transferts.forEach(t=>{html+=`<tr><td>${t.code}</td><td>${t.userType}</td><td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td><td>${t.originLocation}</td><td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td><td>${t.destinationLocation}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td><td>${t.createdAt.toLocaleString()}</td></tr>`;});
  html+='</table></body></html>';
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename="transferts.doc"');
  res.send(html);
});


// ===== GET STOCK =====
app.get('/transferts/stock', requireLogin, async (req,res)=>{
  try {
    const page = parseInt(req.query.page)||1;
    const limit = 20;

    let stocks = await Stock.find().sort({createdAt:-1});
    const totalPages = Math.ceil(stocks.length/limit);
    const paginated = stocks.slice((page-1)*limit, page*limit);

    // Totaux par devise et par destination
    const totals = {}; // {destination:{GNF:0,USD:0,...}}
    stocks.forEach(s=>{
      if(!totals[s.destination]) totals[s.destination] = {GNF:0,EUR:0,USD:0,XOF:0};
      totals[s.destination][s.currency] += s.amount;
    });

    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
      body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
      table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
      th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
      th{background:#ff8c42;color:white;}
      input,select{padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;margin-bottom:10px;}
      button{padding:6px 10px;background:#ff8c42;color:white;border:none;border-radius:6px;cursor:pointer;margin-right:4px;}
      .edit{background:#28a745;} .delete{background:#dc3545;}
    </style></head><body>
    <h2>📦 Gestion du Stock</h2>

    <h3>📊 Totaux par destination et devise</h3>
    <table><thead><tr><th>Destination</th><th>GNF</th><th>EUR</th><th>USD</th><th>XOF</th></tr></thead><tbody>`;
    
    for(let dest in totals){
      html += `<tr>
        <td>${dest}</td>
        <td>${totals[dest].GNF}</td>
        <td>${totals[dest].EUR}</td>
        <td>${totals[dest].USD}</td>
        <td>${totals[dest].XOF}</td>
      </tr>`;
    }

    html += `</tbody></table>

    <form id="stockForm">
      <h3>➕ Nouveau Stock</h3>
      <input name="sender" placeholder="Expéditeur" required>
      <input name="destination" placeholder="Destination" required>
      <input type="number" name="amount" placeholder="Montant" required>
      <select name="currency">${['GNF','EUR','USD','XOF'].map(c=>`<option>${c}</option>`).join('')}</select>
      <button>Enregistrer</button>
    </form>

    <h3>Liste du stock</h3>
    <table><thead><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr></thead><tbody>`;

    paginated.forEach(s=>{
      html += `<tr data-id="${s._id}">
        <td>${s.sender}</td>
        <td>${s.destination}</td>
        <td>${s.amount}</td>
        <td>${s.currency}</td>
        <td>
          <button class="edit">✏️ Modifier</button>
          <button class="delete">❌ Supprimer</button>
        </td>
      </tr>`;
    });

    html += `</tbody></table>
      <div id="pagination">`;
    for(let i=1;i<=totalPages;i++){
      html += `<a href="?page=${i}" style="margin-right:5px;">${i}</a>`;
    }
    html += `</div>

    <script>
      const stockForm = document.getElementById('stockForm');

      // ===== Ajouter ou modifier =====
      stockForm.onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const data = { sender: f.sender.value, destination: f.destination.value, amount: f.amount.value, currency: f.currency.value };
        const method = f.dataset.id ? 'PUT' : 'POST';
        const url = f.dataset.id ? '/transferts/stock/' + f.dataset.id : '/transferts/stock';
        try {
          const res = await fetch(url, {
            method,
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify(data)
          });
          const result = await res.json();
          if(result.ok) window.location.reload();
          else alert('Erreur serveur');
        } catch(err) { console.error(err); alert('Erreur serveur'); }
      };

      // ===== Edit =====
      document.querySelectorAll('.edit').forEach(btn=>{
        btn.onclick = (e)=>{
          const tr = btn.closest('tr');
          stockForm.sender.value = tr.children[0].innerText;
          stockForm.destination.value = tr.children[1].innerText;
          stockForm.amount.value = tr.children[2].innerText;
          stockForm.currency.value = tr.children[3].innerText;
          stockForm.dataset.id = tr.dataset.id;
        };
      });

      // ===== Delete =====
      document.querySelectorAll('.delete').forEach(btn=>{
        btn.onclick = async ()=>{
          if(confirm('❌ Confirmer suppression?')){
            const tr = btn.closest('tr');
            try {
              const res = await fetch('/transferts/stock/' + tr.dataset.id, { method:'DELETE' });
              const result = await res.json();
              if(result.ok) tr.remove();
              else alert('Erreur serveur');
            } catch(err){ console.error(err); alert('Erreur serveur'); }
          }
        };
      });
    </script>
    </body></html>`;
    
    res.send(html);
  } catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur lors du chargement du stock');
  }
});

// ===== POST STOCK =====
app.post('/transferts/stock', requireLogin, async(req,res)=>{
  try {
    const { sender,destination,amount,currency } = req.body;
    if(!sender || !destination || !amount || !currency) return res.status(400).send({ok:false});
    await new Stock({sender,destination,amount,currency}).save();
    res.send({ok:true});
  } catch(err){ console.error(err); res.status(500).send({ok:false}); }
});

// ===== PUT STOCK =====
app.put('/transferts/stock/:id', requireLogin, async(req,res)=>{
  try {
    const { sender,destination,amount,currency } = req.body;
    await Stock.findByIdAndUpdate(req.params.id,{sender,destination,amount,currency});
    res.send({ok:true});
  } catch(err){ console.error(err); res.status(500).send({ok:false}); }
});

// ===== DELETE STOCK =====
app.delete('/transferts/stock/:id', requireLogin, async(req,res)=>{
  try { await Stock.findByIdAndDelete(req.params.id); res.send({ok:true}); }
  catch(err){ console.error(err); res.status(500).send({ok:false}); }
});

// ===== MISE À JOUR DU STOCK LORS DU RETRAIT =====
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try {
    if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');

    const t = await Transfert.findById(req.body.id);
    if(!t) return res.status(404).send('Transfert introuvable');

    // Retrait du transfert
    await Transfert.findByIdAndUpdate(req.body.id, {
      retired:true,
      recoveryMode:req.body.mode,
      $push:{retraitHistory:{date:new Date(),mode:req.body.mode}}
    });

    // === Diminuer le stock correspondant ===
    const stock = await Stock.findOne({
      sender: t.senderFirstName + ' ' + t.senderLastName,
      destination: t.destinationLocation,
      currency: t.currency
    });

    if(stock){
      stock.amount -= t.recoveryAmount;
      if(stock.amount < 0) stock.amount = 0;
      await stock.save();
    }

    res.send({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).send({ok:false});
  }
});





// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
