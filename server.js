/******************************************************************
 * APP TRANSFERT – DASHBOARD AJAX + EXPORTS COMPLET
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

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
  recoveryAmount: Number,
  currency: { type: String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode() {
  let code; let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH / PERMISSIONS =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

function setPermissions(username){
  let permissions = { lecture:true, ecriture:false, retrait:false, modification:true, suppression:true, imprimer:true };
  if(username === 'a'){ permissions = { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true }; }
  if(username === 'admin2'){ permissions = { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true }; }
  return permissions;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
  form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
  input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
  button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
  button:hover{background:#0056b3;}
  </style></head><body>
  <h2>Connexion</h2>
  <form method="post">
  <input name="username" placeholder="Utilisateur" required><br>
  <input type="password" name="password" placeholder="Mot de passe" required><br>
  <button>Connexion</button>
  </form></body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    let user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      user = await new Auth({ username, password: hashed }).save();
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');

    const permissions = setPermissions(username);
    req.session.user = { username:user.username, role:user.role, permissions };
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur: '+err.message);}
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE AJAX =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
  .container{max-width:800px;margin:40px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
  h2{color:#2c7be5;text-align:center;margin-bottom:20px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:15px;}
  label{display:block;margin-bottom:5px;font-weight:bold;color:#555;}
  input,select{width:100%;padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
  input[readonly]{background:#e9ecef;}
  button{width:100%;padding:12px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:0.3s;}
  button:hover{background:#218838;}
  a{display:inline-block;margin-top:15px;color:#2c7be5;text-decoration:none;font-weight:bold;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <div class="container">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form id="transfertForm">
  <h3>Type de personne</h3>
  <select name="userType">
  <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
  <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
  <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
  <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
  </select>

  <h3>Expéditeur</h3><div class="grid">
  <div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
  <div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
  <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
  <div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
  </div>

  <h3>Destinataire</h3><div class="grid">
  <div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
  <div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
  <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
  <div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
  </div>

  <h3>Montants & Devise & Code</h3><div class="grid">
  <div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
  <div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
  <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
  <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
  <div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
  </div>

  <button type="submit">${t?'Enregistrer Modifications':'Enregistrer'}</button>
  </form>
  <center><a href="/transferts/list">⬅ Retour liste</a></center>
  </div>

<script>
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');
function updateRecovery(){const a=parseFloat(amountField.value)||0;const f=parseFloat(feesField.value)||0;recoveryField.value=a-f;}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();

// AJAX pour le formulaire
document.getElementById('transfertForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const res = await fetch('/transferts/form',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  if(res.ok){
    alert('✅ Transfert enregistré');
    window.location.href='/transferts/list';
  } else {
    const txt = await res.text();
    alert('❌ Erreur: '+txt);
  }
});
</script>
</body></html>`);
});

// ================= POST FORMULAIRE AJAX =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  try{
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;
    const code = req.body.code || await generateUniqueCode();
    let existing = await Transfert.findOne({code});
    if(existing){
      await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
    } else {
      await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
    }
    res.json({success:true, code});
  }catch(err){
    res.status(500).send(err.message);
  }
});

// ================= RETRAIT / SUPPRESSION AJAX =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,
    recoveryMode:req.body.mode,
    $push:{ retraitHistory:{ date:new Date(), mode:req.body.mode } }
  });
  res.json({success:true});
});

app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

// ================= LISTE AJAX =================
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

  const limit = 20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit, page*limit);

  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // --- Génération HTML (incluant AJAX pour filtre, retrait, suppression, pagination) ---
  let html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Transferts</title><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#007bff;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  .imprimer{background:#17a2b8;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <h3>📊 Totaux par destination et devise</h3>
  <table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;

  for(let dest in totals){
    for(let curr in totals[dest]){
      html += `<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html += '</tbody></table>';

  html += `<form id="filterForm" style="margin-bottom:10px;">
    <input type="text" name="search" placeholder="Recherche..." value="${search}">
    <select name="status">
      <option value="all" ${status==='all'?'selected':''}>Tous</option>
      <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
      <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
    </select>
    <button>🔍 Filtrer</button>
  </form>`;

  if(req.session.user.permissions.ecriture) html+='<a href="/transferts/form">➕ Nouveau</a> ';
  html+=`<a href="/transferts/pdf">📄 Export PDF</a>
  <a href="/transferts/excel">📊 Export Excel</a>
  <a href="/transferts/word">📝 Export Word</a>
  <a href="/logout">🚪 Déconnexion</a>`;

  html += '<table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';

  paginated.forEach(t=>{
    html += `<tr class="${t.retired?'retired':''}">
      <td>${t.code}</td>
      <td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'En attente'}</td>
      <td>`;
    if(req.session.user.permissions.modification) html+=`<button class="modify" onclick="window.location='/transferts/form?code=${t.code}'">✏️</button>`;
    if(req.session.user.permissions.retrait && !t.retired) html+=`<button class="retirer" onclick="retirer('${t._id}')">💸 Retirer</button>`;
    if(req.session.user.permissions.suppression) html+=`<button class="delete" onclick="supprimer('${t._id}')">🗑️</button>`;
    html+='</td></tr>';
  });
  html+='</tbody></table>';

  html += `<div id="pagination">`;
  for(let p=1;p<=totalPages;p++){
    html += `<a href="#" onclick="goPage(${p})">${p}</a> `;
  }
  html += '</div>';

  html += `<script>
  async function retirer(id){
    const mode = prompt('Mode de retrait (ex: Espèces, Virement):');
    if(!mode) return;
    await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
    location.reload();
  }
  async function supprimer(id){
    if(!confirm('Confirmer suppression?')) return;
    await fetch('/transferts/delete/'+id);
    location.reload();
  }
  document.getElementById('filterForm').addEventListener('submit', function(e){
    e.preventDefault();
    const data = new FormData(this);
    const params = new URLSearchParams(data).toString();
    window.location='/transferts/list?'+params;
  });
  function goPage(p){
    const params = new URLSearchParams({search:'${search}',status:'${status}',page:p}).toString();
    window.location='/transferts/list?'+params;
  }
  </script></body></html>`;
  res.send(html);
});

// ================= EXPORTS =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="transferts.pdf"');
  doc.pipe(res);
  const transferts = await Transfert.find().sort({createdAt:-1});
  doc.fontSize(16).text('Liste des transferts', {align:'center'});
  doc.moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`${t.code} | ${t.senderFirstName} -> ${t.receiverFirstName} | ${t.amount} ${t.currency} | ${t.retired?'Retiré':'En attente'}`);
  });
  doc.end();
});

app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code',key:'code'}, {header:'Expéditeur',key:'sender'},
    {header:'Destinataire',key:'receiver'},{header:'Montant',key:'amount'},
    {header:'Frais',key:'fees'},{header:'Reçu',key:'recovery'},
    {header:'Devise',key:'currency'},{header:'Status',key:'status'}
  ];
  const transferts = await Transfert.find().sort({createdAt:-1});
  transferts.forEach(t=>sheet.addRow({
    code:t.code,
    sender:`${t.senderFirstName} ${t.senderLastName}`,
    receiver:`${t.receiverFirstName} ${t.receiverLastName}`,
    amount:t.amount, fees:t.fees, recovery:t.recoveryAmount,
    currency:t.currency,
    status:t.retired?'Retiré':'En attente'
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/transferts/word', requireLogin, async(req,res)=>{
  let content = '<html><body><h2>Liste des transferts</h2><table border="1" cellpadding="5">';
  content += '<tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th></tr>';
  const transferts = await Transfert.find().sort({createdAt:-1});
  transferts.forEach(t=>{
    content += `<tr><td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'En attente'}</td></tr>`;
  });
  content += '</table></body></html>';
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename="transferts.doc"');
  res.send(content);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
