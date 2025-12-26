/******************************************************************
 * APP TRANSFERT – SERVER EXPRESS + MONGODB + AJAX + EXPORTS
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

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
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
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

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Connexion</title>
<style>
body{margin:0;font-family:Arial;background:#f0f4f8;display:flex;justify-content:center;align-items:center;height:100vh;}
.login-container{background:#fff;padding:30px 40px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.2);width:320px;text-align:center;}
h2{color:#2c7be5;margin-bottom:20px;}
input{width:100%;padding:12px;margin:8px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;}
button{width:100%;padding:12px;margin-top:10px;border:none;border-radius:8px;background:#007bff;color:white;font-weight:bold;font-size:15px;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
</style></head>
<body>
<div class="login-container">
<h2>Connexion</h2>
<form method="POST" action="/login">
<input type="text" name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div>
</body></html>`);
});

app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = await new Auth({ username, password: hashed }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username };
  res.redirect('/transferts');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= CONSTANTS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= PAGE PRINCIPALE TRANSFERTS =================
app.get('/transferts', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode(); // pour formulaire rapide
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Transferts</title>
<style>
body{font-family:Arial;margin:10px;background:#f4f6f9;}
h2{color:#2c7be5;text-align:center;margin-bottom:15px;}
.table-container{width:100%;overflow-x:auto;max-height:60vh;border:1px solid #ccc;border-radius:5px;background:#fff;position:relative;}
table{width:100%;border-collapse: collapse;min-width:900px;}
th, td{border:1px solid #ccc;padding:8px;text-align:left;font-size:14px;cursor:pointer;}
th{background:#007bff;color:white;position: sticky;top:0;z-index:2;}
.retired{background:#fff3b0;}
button, a.button{padding:6px 10px;border:none;border-radius:5px;color:white;text-decoration:none;font-size:12px;cursor:pointer;margin-right:3px;}
.modify{background:#28a745;}
.delete{background:#dc3545;}
.retirer{background:#ff9900;}
.imprimer{background:#17a2b8;}
.export{background:#6c757d;}
#filters{display:flex;flex-wrap: wrap;gap:10px;margin-bottom:10px;}
#filters input,#filters select{padding:6px;border-radius:5px;border:1px solid #ccc;font-size:14px;}
#loadingSpinner{display:none;position:absolute;top:50%;left:50%;transform: translate(-50%, -50%);width:40px;height:40px;border:5px solid #ccc;border-top:5px solid #007bff;border-radius:50%;animation: spin 1s linear infinite;}
@keyframes spin{0%{transform: translate(-50%, -50%) rotate(0deg);}100%{transform: translate(-50%, -50%) rotate(360deg);}}
.fade-in{animation: fadeIn 0.6s ease forwards;opacity:0;}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);justify-content:center;align-items:center;}
.modal-content{background:#fff;padding:20px;border-radius:8px;width:90%;max-width:500px;position:relative;}
.modal-content h3{margin-top:0;}
.modal-close{position:absolute;top:10px;right:10px;cursor:pointer;font-size:18px;font-weight:bold;}
@media (max-width:768px){td{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #ccc;}td button, td a.button{margin-left:5px;margin-top:0;flex-shrink:0;}td::before{content: attr(data-label);font-weight:bold;flex:1;}}
</style>
</head>
<body>

<h2>📋 Liste des transferts</h2>

<div id="filters">
<input id="searchInput" placeholder="Recherche...">
<select id="statusSelect">
<option value="all">Tous</option>
<option value="retire">Retirés</option>
<option value="non">Non retirés</option>
</select>
<select id="currencySelect">
<option value="">Toutes devises</option>
<option value="GNF">GNF</option>
<option value="EUR">EUR</option>
<option value="USD">USD</option>
<option value="XOF">XOF</option>
</select>
<select id="destinationSelect">
<option value="">Toutes destinations</option>
${locations.map(v=>`<option value="${v}">${v}</option>`).join('')}
</select>
<button id="addTransfertBtn" class="button modify">➕ Nouveau</button>
<a href="/transferts/excel" class="button export">📊 Excel</a>
<a href="/transferts/word" class="button export">📄 Word</a>
<a href="/logout" class="button delete">🚪 Déconnexion</a>
</div>

<div class="table-container">
<div id="loadingSpinner"></div>
<table>
<thead>
<tr>
<th data-key="code">Code</th>
<th data-key="userType">Type</th>
<th data-key="senderFirstName">Expéditeur</th>
<th data-key="originLocation">Origine</th>
<th data-key="receiverFirstName">Destinataire</th>
<th data-key="amount">Montant</th>
<th data-key="fees">Frais</th>
<th data-key="recoveryAmount">Reçu</th>
<th data-key="currency">Devise</th>
<th data-key="retired">Status</th>
<th>Actions</th>
</tr>
</thead>
<tbody id="transfertsBody"></tbody>
</table>
</div>
<div id="pagination" style="margin-top:10px;"></div>

<!-- MODAL FORMULAIRE -->
<div class="modal" id="transfertModal">
<div class="modal-content">
<span class="modal-close" id="modalClose">&times;</span>
<h3 id="modalTitle">➕ Nouveau Transfert</h3>
<form id="transfertForm">
<input type="hidden" name="code" id="code" value="${code}">
<label>Type:</label>
<select name="userType" id="userType" required>
<option>Client</option>
<option>Distributeur</option>
<option>Administrateur</option>
<option>Agence de transfert</option>
</select>
<label>Expéditeur:</label>
<input name="senderFirstName" placeholder="Prénom" required>
<input name="senderLastName" placeholder="Nom" required>
<input name="senderPhone" placeholder="Téléphone" required>
<select name="originLocation">${locations.map(v=>`<option>${v}</option>`).join('')}</select>
<label>Destinataire:</label>
<input name="receiverFirstName" placeholder="Prénom" required>
<input name="receiverLastName" placeholder="Nom" required>
<input name="receiverPhone" placeholder="Téléphone" required>
<select name="destinationLocation">${locations.map(v=>`<option>${v}</option>`).join('')}</select>
<label>Montants:</label>
<input type="number" name="amount" placeholder="Montant" required>
<input type="number" name="fees" placeholder="Frais" required>
<input type="text" name="recoveryAmount" placeholder="Montant à recevoir" readonly>
<select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
<button type="submit" class="button modify">Enregistrer</button>
</form>
</div>
</div>

<script>
let currentSort={key:'',order:''};let currentPage=1;const refreshInterval=10000;
const modal=document.getElementById('transfertModal');
const addBtn=document.getElementById('addTransfertBtn');
const closeBtn=document.getElementById('modalClose');
const form=document.getElementById('transfertForm');

addBtn.onclick=()=>{modal.style.display='flex';document.getElementById('modalTitle').textContent='➕ Nouveau Transfert';form.reset();}
closeBtn.onclick=()=>modal.style.display='none';
window.onclick=(e)=>{if(e.target==modal)modal.style.display='none';}

// Calcul montant à recevoir
const amountField=form.querySelector('[name="amount"]');
const feesField=form.querySelector('[name="fees"]');
const recoveryField=form.querySelector('[name="recoveryAmount"]');
function updateRecovery(){const a=parseFloat(amountField.value)||0;const f=parseFloat(feesField.value)||0;recoveryField.value=(a-f).toFixed(2);}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);

// Soumission AJAX
form.onsubmit=async(e)=>{
e.preventDefault();
const data=Object.fromEntries(new FormData(form).entries());
data.amount=parseFloat(data.amount);data.fees=parseFloat(data.fees);data.recoveryAmount=parseFloat(data.amount-data.fees);
const res=await fetch('/transferts/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
if(res.ok){modal.style.display='none';loadTransferts(currentPage);}};

// ================= TRANSFERTS AJAX =================
async function loadTransferts(page=1){
currentPage=page;document.getElementById('loadingSpinner').style.display='block';
const search=document.getElementById('searchInput').value;
const status=document.getElementById('statusSelect').value;
const currency=document.getElementById('currencySelect').value;
const destination=document.getElementById('destinationSelect').value;
try{
let url=`/transferts/list?search=${search}&status=${status}&currency=${currency}&destination=${destination}&page=${page}&ajax=1`;
if(currentSort.key) url+=`&sortKey=${currentSort.key}&sortOrder=${currentSort.order}`;
const res=await fetch(url);const data=await res.json();
const tbody=document.getElementById('transfertsBody');tbody.innerHTML='';
data.transferts.forEach(t=>{
const tr=document.createElement('tr');if(t.retired)tr.classList.add('retired');tr.classList.add('fade-in');
tr.innerHTML=`<td data-label="Code">${t.code}</td>
<td data-label="Type">${t.userType}</td>
<td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
<td data-label="Origine">${t.originLocation}</td>
<td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
<td data-label="Montant">${t.amount}</td>
<td data-label="Frais">${t.fees}</td>
<td data-label="Reçu">${t.recoveryAmount}</td>
<td data-label="Devise">${t.currency}</td>
<td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
<td>
<button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
<button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
</td>`;
tbody.appendChild(tr);
});
const pagination=document.getElementById('pagination');pagination.innerHTML='';
for(let i=1;i<=data.totalPages;i++){const a=document.createElement('a');a.href="#";a.textContent=i;if(i===currentPage)a.style.fontWeight='bold';a.onclick=(e)=>{e.preventDefault();loadTransferts(i);};pagination.appendChild(a);pagination.appendChild(document.createTextNode(' '));}
}catch(err){console.error(err);}finally{document.getElementById('loadingSpinner').style.display='none';}
}
document.querySelectorAll('th[data-key]').forEach(th=>{th.addEventListener('click',()=>{if(currentSort.key===th.dataset.key)currentSort.order=currentSort.order==='asc'?'desc':'asc';else{currentSort.key=th.dataset.key;currentSort.order='asc';}loadTransferts(currentPage);});});
['searchInput','statusSelect','currencySelect','destinationSelect'].forEach(id=>{const el=document.getElementById(id);el.addEventListener('input',()=>loadTransferts(1));el.addEventListener('change',()=>loadTransferts(1));});
loadTransferts();
setInterval(()=>loadTransferts(currentPage),refreshInterval);

// Edit / Delete
async function editTransfert(id){
const res=await fetch('/transferts/get/'+id);const t=await res.json();
modal.style.display='flex';
document.getElementById('modalTitle').textContent='✏️ Modifier Transfert';
form.code.value=t.code;form.userType.value=t.userType;form.senderFirstName.value=t.senderFirstName;
form.senderLastName.value=t.senderLastName;form.senderPhone.value=t.senderPhone;
form.originLocation.value=t.originLocation;form.receiverFirstName.value=t.receiverFirstName;
form.receiverLastName.value=t.receiverLastName;form.receiverPhone.value=t.receiverPhone;
form.destinationLocation.value=t.destinationLocation;form.amount.value=t.amount;
form.fees.value=t.fees;updateRecovery();form.currency.value=t.currency;
}

async function deleteTransfert(id){
if(!confirm('❌ Confirmer la suppression?')) return;
await fetch('/transferts/delete/'+id,{method:'DELETE'});
loadTransferts(currentPage);
}
</script>
</body></html>`);
});

// ================= API TRANSFERTS =================
app.post('/transferts/save', requireLogin, async(req,res)=>{
const data=req.body;
let existing=await Transfert.findOne({code:data.code});
if(existing){
await Transfert.findByIdAndUpdate(existing._id,{...data});
}else{await new Transfert({...data}).save();}
res.sendStatus(200);
});

app.get('/transferts/get/:id', requireLogin, async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.json(t);
});

app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{
await Transfert.findByIdAndDelete(req.params.id);
res.sendStatus(200);
});

// ================= LIST AJAX =================
app.get('/transferts/list', requireLogin, async (req,res)=>{
  const { search='', status='all', currency='', destination='', page=1, sortKey='', sortOrder='asc', ajax } = req.query;
  let query = {};
  if(search){const regex=new RegExp(search,'i');query.$or=[{code:regex},{senderFirstName:regex},{senderLastName:regex},{senderPhone:regex},{receiverFirstName:regex},{receiverLastName:regex},{receiverPhone:regex}];}
  if(status==='retire') query.retired=true;
  if(status==='non') query.retired=false;
  if(currency) query.currency=currency;
  if(destination) query.destinationLocation=destination;

  let transferts=await Transfert.find(query);
  if(sortKey){transferts.sort((a,b)=>{let v1=a[sortKey],v2=b[sortKey];if(typeof v1==='string')v1=v1.toLowerCase();if(typeof v2==='string')v2=v2.toLowerCase();if(v1<v2)return sortOrder==='asc'?-1:1;if(v1>v2)return sortOrder==='asc'?1:-1;return 0;});}
  const limit=20; const totalPages=Math.ceil(transferts.length/limit); const paginated=transferts.slice((page-1)*limit,page*limit);
  res.json({ transferts:paginated,totalPages });
});

// ================= EXPORTS =================
// Excel
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts=await Transfert.find();
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Transferts');
  sheet.columns=[{header:'Code', key:'code'},{header:'Type', key:'userType'},{header:'Expéditeur', key:'sender'},{header:'Origine', key:'origin'},{header:'Destinataire', key:'receiver'},{header:'Montant', key:'amount'},{header:'Frais', key:'fees'},{header:'Reçu', key:'recovery'},{header:'Devise', key:'currency'},{header:'Status', key:'status'}];
  transferts.forEach(t=>{sheet.addRow({code:t.code,userType:t.userType,sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,origin:t.originLocation,receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,amount:t.amount,fees:t.fees,recovery:t.recoveryAmount,currency:t.currency,status:t.retired?'Retiré':'Non retiré'});});
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res);res.end();
});
// Word
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts=await Transfert.find();
  const doc=new Document();
  transferts.forEach(t=>{doc.addSection({children:[new Paragraph({children:[new TextRun(`Code: ${t.code} Type: ${t.userType} Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) Montant: ${t.amount} ${t.currency} Frais: ${t.fees} Reçu: ${t.recoveryAmount} Statut: ${t.retired?'Retiré':'Non retiré'}`)])]});});
  const buffer=await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
