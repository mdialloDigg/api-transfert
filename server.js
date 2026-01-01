const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert', { useNewUrlParser: true, useUnifiedTopology: true });

const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], required: true },
  senderFirstName: String, senderLastName: String, senderPhone: String, originLocation: String,
  receiverFirstName: String, receiverLastName: String, receiverPhone: String, destinationLocation: String,
  amount: Number, fees: Number, recoveryAmount: Number, currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  recoveryMode: String, retraitHistory: [{ date: Date, mode: String }], retired: { type: Boolean, default: false },
  code: { type: String, unique: true }, createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username: String, password: String, role: { type: String, enum: ['admin','agent'], default:'agent' } });
const Auth = mongoose.model('Auth', authSchema);

async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    const letter = String.fromCharCode(65+Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code});
  }
  return code;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='admin') return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
    .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
    .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
    .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
    .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;}
    .login-container button:hover{background:#e67300;}
  </style></head><body>
  <div class="login-container"><h2>Connexion</h2>
  <form method="post"><input name="username" placeholder="Utilisateur" required><input type="password" name="password" placeholder="Mot de passe" required><button>Se connecter</button></form>
  </div></body></html>`);
});

app.post('/login', async(req,res)=>{
  const {username,password}=req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = {username:user.username, role:user.role, permissions:setPermissions(username)};
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form',requireLogin,async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  let html='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}.container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;}label{font-weight:bold;display:block;margin-top:10px;}input,select{padding:10px;width:100%;border-radius:6px;border:1px solid #ccc;}button{margin-top:15px;padding:12px;background:#ff8c42;color:white;border:none;border-radius:8px;cursor:pointer;}</style></head><body><div class="container">';
  html+=`<h2>${t?'Modifier':'Nouveau'} Transfert</h2><form method="post">`;
  html+=`<label>Code</label><input name="code" value="${code}" readonly>`;
  html+=`<label>Type</label><select name="userType">${['Client','Distributeur','Administrateur','Agence de transfert'].map(u=>`<option ${t&&t.userType===u?'selected':''}>${u}</option>`).join('')}</select>`;
  html+=`<label>Expéditeur Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required>`;
  html+=`<label>Expéditeur Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required>`;
  html+=`<label>Expéditeur Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required>`;
  html+=`<label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select>`;
  html+=`<label>Destinataire Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required>`;
  html+=`<label>Destinataire Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required>`;
  html+=`<label>Destinataire Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required>`;
  html+=`<label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select>`;
  html+=`<label>Montant</label><input type="number" id="amount" name="amount" value="${t?t.amount:''}" required>`;
  html+=`<label>Frais</label><input type="number" id="fees" name="fees" value="${t?t.fees:''}" required>`;
  html+=`<label>Montant à recevoir</label><input type="text" id="recoveryAmount" name="recoveryAmount" readonly value="${t?t.recoveryAmount:''}">`;
  html+=`<label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>`;
  html+=`<label>Mode de retrait</label><select name="recoveryMode">${retraitModes.map(r=>`<option ${t&&t.recoveryMode===r?'selected':''}>${r}</option>`).join('')}</select>`;
  html+=`<button>${t?'Enregistrer Modifications':'Enregistrer'}</button></form>`;
  html+='<a href="/transferts/list">⬅ Retour liste</a>';
  html+=`<script>
    const amountField=document.getElementById('amount');
    const feesField=document.getElementById('fees');
    const recoveryField=document.getElementById('recoveryAmount');
    function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
    amountField.addEventListener('input',updateRecovery);
    feesField.addEventListener('input',updateRecovery);
    updateRecovery();
  </script></div></body></html>`;
  res.send(html);
});

// ================= POST FORMULAIRE =================
app.post('/transferts/form',requireLogin,async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount=Number(req.body.amount||0);
  const fees=Number(req.body.fees||0);
  const recoveryAmount=amount-fees;
  const code=req.body.code||await generateUniqueCode();
  let existing=await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const search=(req.query.search||'').toLowerCase();
  let transferts = await Transfert.find().sort({createdAt:-1});
  transferts = transferts.filter(t=>{
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
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  });

  let html='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:5px;} th{background:#ff8c42;color:white;} .retired{background:#fff3b0;} button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;} .delete{background:#dc3545;} .retirer{background:#ff9900;} .imprimer{background:#17a2b8;}</style></head><body>';
  html+='<h2>📋 Liste des transferts</h2>';

  html+='<h3>Totaux par destination/devise</h3><table><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr>';
  for(let dest in totals){
    for(let cur in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${cur}</td><td>${totals[dest][cur].amount}</td><td>${totals[dest][cur].fees}</td><td>${totals[dest][cur].recovery}</td></tr>`;
    }
  }
  html+='</table>';

  html+=`<input type="text" id="search" placeholder="Recherche..."><button id="filter">🔍 Filtrer</button><a href="/transferts/form">➕ Nouveau</a><a href="/logout">🚪 Déconnexion</a>`;
  html+='<table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
  transferts.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td><td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td>
      <td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        ${req.session.user.permissions.retrait && !t.retired?`<select class="retirementMode">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select><button class="retirer">💰 Retirer</button>`:''}
        ${req.session.user.permissions.suppression?'<button class="delete">❌ Supprimer</button>':''}
        ${req.session.user.permissions.imprimer?`<a href="/transferts/print/${t._id}" target="_blank"><button class="imprimer">🖨️ Imprimer</button></a>`:''}
      </td>
    </tr>`;
  });
  html+='</tbody></table>';
  html+=`<button id="exportPDF">📄 Export PDF</button> <button id="exportExcel">📊 Export Excel</button>`;
  html+=`<script>
    document.getElementById('filter').onclick = ()=>{window.location='/transferts/list?search='+encodeURIComponent(document.getElementById('search').value)};
    document.querySelectorAll('.delete').forEach(b=>b.onclick=async()=>{if(confirm('Supprimer ?')){const tr=b.closest('tr');await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tr.dataset.id})});tr.remove();}});
    document.querySelectorAll('.retirer').forEach(b=>b.onclick=async()=>{const tr=b.closest('tr');const mode=tr.querySelector('.retirementMode').value;await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tr.dataset.id,mode})});tr.querySelector('td:nth-child(11)').innerText='Retiré';b.remove();tr.querySelector('.retirementMode').remove();});
    document.getElementById('exportPDF').onclick = ()=>{window.open('/transferts/export/pdf')};
    document.getElementById('exportExcel').onclick = ()=>{window.open('/transferts/export/excel')};
  </script>`;
  html+='</body></html>';
  res.send(html);
});

// ================= AJAX =================
app.post('/transferts/delete',requireLogin,async(req,res)=>{await Transfert.findByIdAndDelete(req.body.id);res.send({ok:true});});
app.post('/transferts/retirer',requireLogin,async(req,res)=>{await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});res.send({ok:true});});

// ================= EXPORT PDF =================
app.get('/transferts/export/pdf',requireLogin,async(req,res)=>{
  const transferts = await Transfert.find();
  const doc = new PDFDocument({margin:30,size:'A4'});
  res.setHeader('Content-disposition','attachment; filename=transferts.pdf');
  res.setHeader('Content-type','application/pdf');
  doc.text('Liste des transferts', {align:'center', underline:true});
  transferts.forEach(t=>{
    doc.moveDown(0.2).text(`${t.code} | ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName} | ${t.amount} ${t.currency} | ${t.retired?'Retiré':'Non retiré'}`);
  });
  doc.pipe(res);
  doc.end();
});

// ================= EXPORT EXCEL =================
app.get('/transferts/export/excel',requireLogin,async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.addRow(['Code','Type','Expéditeur','Origine','Destinataire','Destination','Montant','Frais','Reçu','Devise','Status']);
  transferts.forEach(t=>{
    sheet.addRow([t.code,t.userType,`${t.senderFirstName} ${t.senderLastName}`,t.originLocation,`${t.receiverFirstName} ${t.receiverLastName}`,t.destinationLocation,t.amount,t.fees,t.recoveryAmount,t.currency,t.retired?'Retiré':'Non retiré']);
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= PRINT =================
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body><h2>Transfert ${t.code}</h2>
  <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
  <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
  <p>Origine: ${t.originLocation}</p>
  <p>Destination: ${t.destinationLocation}</p>
  <p>Montant: ${t.amount}</p>
  <p>Frais: ${t.fees}</p>
  <p>Montant à recevoir: ${t.recoveryAmount}</p>
  <p>Devise: ${t.currency}</p>
  <p>Mode de retrait: ${t.recoveryMode}</p>
  <button onclick="window.print()">🖨️ Imprimer</button></body></html>`);
});

app.listen(process.env.PORT||3000,()=>console.log('Server running'));
