require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- MODELES --------------------
const Schema = mongoose.Schema;

const TransfertSchema = new Schema({
  code: String,
  senderFirstName: String,
  receiverFirstName: String,
  amount: Number,
  currency: String,
  retired: { type: Boolean, default: false }
}, { timestamps: true });

const StockSchema = new Schema({
  name: String,
  quantity: Number,
  price: Number
}, { timestamps: true });

const ClientSchema = new Schema({
  firstName: String,
  lastName: String,
  phone: String,
  email: String
}, { timestamps: true });

const DeviseSchema = new Schema({
  name: String,
  rate: Number
}, { timestamps: true });

const Transfert = mongoose.model('Transfert', TransfertSchema);
const Stock = mongoose.model('Stock', StockSchema);
const Client = mongoose.model('Client', ClientSchema);
const Devise = mongoose.model('Devise', DeviseSchema);

// -------------------- MONGODB --------------------
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
.then(()=>console.log('MongoDB connected'))
.catch(err=>console.error('MongoDB error:', err));

// -------------------- ROLE --------------------
function checkRole(role){
  return (req,res,next)=>{
    req.userRole = req.query.role || 'user';
    if(role && req.userRole !== role) return res.status(403).json({error:'Forbidden'});
    next();
  }
}

// -------------------- ROUTES CRUD --------------------
// Transferts
app.get('/api/transferts', async (req,res)=>{
  const { code='', sender='', receiver='', currency='', retired='' } = req.query;
  const filt={};
  if(code) filt.code=new RegExp(code,'i');
  if(sender) filt.senderFirstName=new RegExp(sender,'i');
  if(receiver) filt.receiverFirstName=new RegExp(receiver,'i');
  if(currency) filt.currency=currency;
  if(retired) filt.retired=retired==='true';
  res.json(await Transfert.find(filt).sort({createdAt:-1}));
});
app.post('/api/transferts', async (req,res)=>{ 
  const t = new Transfert({...req.body, code: Math.random().toString(36).substring(2,8).toUpperCase()}); 
  await t.save(); res.json({success:true});
});
app.put('/api/transferts/:id', async (req,res)=>{ await Transfert.findByIdAndUpdate(req.params.id,req.body); res.json({success:true}); });
app.delete('/api/transferts/:id', checkRole('admin'), async (req,res)=>{ await Transfert.findByIdAndDelete(req.params.id); res.json({success:true}); });
app.post('/api/transferts/:id/retirer', checkRole('admin'), async (req,res)=>{ await Transfert.findByIdAndUpdate(req.params.id,{retired:true}); res.json({success:true}); });

// Stocks
app.get('/api/stocks', async (req,res)=>res.json(await Stock.find().sort({createdAt:-1})));
app.post('/api/stocks', async (req,res)=>{ await new Stock(req.body).save(); res.json({success:true}); });
app.put('/api/stocks/:id', async (req,res)=>{ await Stock.findByIdAndUpdate(req.params.id,req.body); res.json({success:true}); });
app.delete('/api/stocks/:id', checkRole('admin'), async (req,res)=>{ await Stock.findByIdAndDelete(req.params.id); res.json({success:true}); });

// Clients
app.get('/api/clients', async (req,res)=>res.json(await Client.find().sort({createdAt:-1})));
app.post('/api/clients', async (req,res)=>{ await new Client(req.body).save(); res.json({success:true}); });
app.put('/api/clients/:id', async (req,res)=>{ await Client.findByIdAndUpdate(req.params.id,req.body); res.json({success:true}); });
app.delete('/api/clients/:id', checkRole('admin'), async (req,res)=>{ await Client.findByIdAndDelete(req.params.id); res.json({success:true}); });

// Devises
app.get('/api/devises', async (req,res)=>res.json(await Devise.find().sort({createdAt:-1})));
app.post('/api/devises', async (req,res)=>{ await new Devise(req.body).save(); res.json({success:true}); });
app.put('/api/devises/:id', async (req,res)=>{ await Devise.findByIdAndUpdate(req.params.id,req.body); res.json({success:true}); });
app.delete('/api/devises/:id', checkRole('admin'), async (req,res)=>{ await Devise.findByIdAndDelete(req.params.id); res.json({success:true}); });

// -------------------- FRONTEND --------------------
app.get('/', (req,res)=>{
  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Dashboard Modals</title>
<style>
body{font-family:sans-serif;background:#f0f2f5;margin:0;padding:20px;}
h1{text-align:center;color:#333;}
.container{display:flex;flex-wrap:wrap;gap:20px;}
.card{background:white;padding:15px;border-radius:8px;flex:1;min-width:300px;box-shadow:0 0 10px rgba(0,0,0,0.1);}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th,td{padding:8px;border:1px solid #ccc;text-align:left;}
th{background:#007bff;color:white;}
button{margin:2px;padding:5px 10px;border:none;border-radius:5px;cursor:pointer;}
.editBtn{background:#28a745;color:white;}
.adminBtn{background:#dc3545;color:white;}
.retireBtn{background:#ffc107;}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
.modal-content{background:white;padding:20px;border-radius:8px;width:300px;position:relative;}
.modal-content input{width:100%;margin:5px 0;padding:5px;}
.closeBtn{position:absolute;top:5px;right:10px;cursor:pointer;color:red;font-weight:bold;}
</style>
</head>
<body>
<h1>Dashboard Moderne</h1>
<label>Role:
<select id="roleSelect">
<option value="user">User</option>
<option value="admin">Admin</option>
</select>
</label>
<div class="container">

<div class="card" id="transfertCard">
<h2>Transferts</h2>
<button onclick="openModal('transfert')">Ajouter Transfert</button>
<button onclick="printTable('transfertTable')">Imprimer</button>
<table id="transfertTable">
<tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Currency</th><th>Retired</th><th>Actions</th></tr>
</table>
</div>

<div class="card" id="stockCard">
<h2>Stocks</h2>
<button onclick="openModal('stock')">Ajouter Stock</button>
<button onclick="printTable('stockTable')">Imprimer</button>
<table id="stockTable">
<tr><th>Name</th><th>Quantity</th><th>Price</th><th>Actions</th></tr>
</table>
</div>

<div class="card" id="clientCard">
<h2>Clients</h2>
<button onclick="openModal('client')">Ajouter Client</button>
<button onclick="printTable('clientTable')">Imprimer</button>
<table id="clientTable">
<tr><th>First</th><th>Last</th><th>Phone</th><th>Email</th><th>Actions</th></tr>
</table>
</div>

<div class="card" id="deviseCard">
<h2>Devises</h2>
<button onclick="openModal('devise')">Ajouter Devise</button>
<button onclick="printTable('deviseTable')">Imprimer</button>
<table id="deviseTable">
<tr><th>Name</th><th>Rate</th><th>Actions</th></tr>
</table>
</div>

</div>

<!-- Modals -->
<div class="modal" id="modal">
<div class="modal-content">
<span class="closeBtn" onclick="closeModal()">×</span>
<h3 id="modalTitle"></h3>
<div id="modalBody"></div>
<button onclick="saveModal()">Enregistrer</button>
</div>
</div>

<script>
let currentModalType='';
let currentEditId=null;

function getRole(){ return document.getElementById('roleSelect').value; }

function openModal(type,data={}){
  currentModalType=type;
  currentEditId=data._id||null;
  document.getElementById('modalTitle').innerText= currentEditId ? 'Modifier '+type : 'Ajouter '+type;
  let html='';
  if(type==='transfert'){
    html=\`
    <input id="mSender" placeholder="Sender" value="\${data.senderFirstName||''}">
    <input id="mReceiver" placeholder="Receiver" value="\${data.receiverFirstName||''}">
    <input id="mAmount" placeholder="Amount" type="number" value="\${data.amount||''}">
    <input id="mCurrency" placeholder="Currency" value="\${data.currency||''}">\`;
  } else if(type==='stock'){
    html=\`
    <input id="mName" placeholder="Name" value="\${data.name||''}">
    <input id="mQty" placeholder="Quantity" type="number" value="\${data.quantity||''}">
    <input id="mPrice" placeholder="Price" type="number" value="\${data.price||''}">\`;
  } else if(type==='client'){
    html=\`
    <input id="mFirst" placeholder="First Name" value="\${data.firstName||''}">
    <input id="mLast" placeholder="Last Name" value="\${data.lastName||''}">
    <input id="mPhone" placeholder="Phone" value="\${data.phone||''}">
    <input id="mEmail" placeholder="Email" value="\${data.email||''}">\`;
  } else if(type==='devise'){
    html=\`
    <input id="mName" placeholder="Name" value="\${data.name||''}">
    <input id="mRate" placeholder="Rate" type="number" value="\${data.rate||''}">\`;
  }
  document.getElementById('modalBody').innerHTML=html;
  document.getElementById('modal').style.display='flex';
}

function closeModal(){ document.getElementById('modal').style.display='none'; }

async function saveModal(){
  const role=getRole();
  let url='',method='POST',body={};
  if(currentModalType==='transfert'){
    body={senderFirstName:document.getElementById('mSender').value,
          receiverFirstName:document.getElementById('mReceiver').value,
          amount:document.getElementById('mAmount').value,
          currency:document.getElementById('mCurrency').value};
    url='/api/transferts'+(currentEditId?'/'+currentEditId:'');
    method=currentEditId?'PUT':'POST';
    if(currentEditId) url+='?role='+role; else url+='?role='+role;
  } else if(currentModalType==='stock'){
    body={name:document.getElementById('mName').value,
          quantity:document.getElementById('mQty').value,
          price:document.getElementById('mPrice').value};
    url='/api/stocks'+(currentEditId?'/'+currentEditId:'');
    method=currentEditId?'PUT':'POST';
    if(currentEditId) url+='?role='+role; else url+='?role='+role;
  } else if(currentModalType==='client'){
    body={firstName:document.getElementById('mFirst').value,
          lastName:document.getElementById('mLast').value,
          phone:document.getElementById('mPhone').value,
          email:document.getElementById('mEmail').value};
    url='/api/clients'+(currentEditId?'/'+currentEditId:'');
    method=currentEditId?'PUT':'POST';
    if(currentEditId) url+='?role='+role; else url+='?role='+role;
  } else if(currentModalType==='devise'){
    body={name:document.getElementById('mName').value,
          rate:document.getElementById('mRate').value};
    url='/api/devises'+(currentEditId?'/'+currentEditId:'');
    method=currentEditId?'PUT':'POST';
    if(currentEditId) url+='?role='+role; else url+='?role='+role;
  }
  await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  closeModal();
  loadAll();
}

// --- LOAD DATA ---
async function loadTransferts(){
  const role=getRole();
  const res=await fetch('/api/transferts?role='+role);
  const data=await res.json();
  const table=document.getElementById('transfertTable');
  table.innerHTML='<tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Currency</th><th>Retired</th><th>Actions</th></tr>';
  data.forEach(t=>{
    const tr=document.createElement('tr');
    tr.innerHTML=\`
      <td>\${t.code}</td><td>\${t.senderFirstName}</td><td>\${t.receiverFirstName}</td>
      <td>\${t.amount}</td><td>\${t.currency}</td><td>\${t.retired}</td>
      <td>
      <button class="editBtn" onclick='openModal("transfert",\${JSON.stringify(t)})'>Modifier</button>
      \${role==="admin"?'<button class="retireBtn" onclick="retirerTransfert(\\'\'+t._id+'\\')">Retirer</button>':''}
      \${role==="admin"?'<button class="adminBtn" onclick="deleteTransfert(\\'\'+t._id+'\\')">Supprimer</button>':''}
      </td>\`;
    table.appendChild(tr);
  });
}

async function loadStocks(){
  const role=getRole();
  const res=await fetch('/api/stocks?role='+role);
  const data=await res.json();
  const table=document.getElementById('stockTable');
  table.innerHTML='<tr><th>Name</th><th>Quantity</th><th>Price</th><th>Actions</th></tr>';
  data.forEach(s=>{
    const tr=document.createElement('tr');
    tr.innerHTML=\`<td>\${s.name}</td><td>\${s.quantity}</td><td>\${s.price}</td>
    <td>
    <button class="editBtn" onclick='openModal("stock",\${JSON.stringify(s)})'>Modifier</button>
    \${role==="admin"?'<button class="adminBtn" onclick="deleteStock(\\'\'+s._id+'\\')">Supprimer</button>':''}
    </td>\`;
    table.appendChild(tr);
  });
}

async function loadClients(){
  const role=getRole();
  const res=await fetch('/api/clients?role='+role);
  const data=await res.json();
  const table=document.getElementById('clientTable');
  table.innerHTML='<tr><th>First</th><th>Last</th><th>Phone</th><th>Email</th><th>Actions</th></tr>';
  data.forEach(c=>{
    const tr=document.createElement('tr');
    tr.innerHTML=\`<td>\${c.firstName}</td><td>\${c.lastName}</td><td>\${c.phone}</td><td>\${c.email}</td>
    <td>
    <button class="editBtn" onclick='openModal("client",\${JSON.stringify(c)})'>Modifier</button>
    \${role==="admin"?'<button class="adminBtn" onclick="deleteClient(\\'\'+c._id+'\\')">Supprimer</button>':''}
    </td>\`;
    table.appendChild(tr);
  });
}

async function loadDevises(){
  const role=getRole();
  const res=await fetch('/api/devises?role='+role);
  const data=await res.json();
  const table=document.getElementById('deviseTable');
  table.innerHTML='<tr><th>Name</th><th>Rate</th><th>Actions</th></tr>';
  data.forEach(d=>{
    const tr=document.createElement('tr');
    tr.innerHTML=\`<td>\${d.name}</td><td>\${d.rate}</td>
    <td>
    <button class="editBtn" onclick='openModal("devise",\${JSON.stringify(d)})'>Modifier</button>
    \${role==="admin"?'<button class="adminBtn" onclick="deleteDevise(\\'\'+d._id+'\\')">Supprimer</button>':''}
    </td>\`;
    table.appendChild(tr);
  });
}

async function deleteTransfert(id){ if(confirm('Supprimer?')) await fetch('/api/transferts/'+id+'?role=admin',{method:'DELETE'}); loadAll();}
async function retirerTransfert(id){ if(confirm('Retirer?')) await fetch('/api/transferts/'+id+'/retirer?role=admin',{method:'POST'}); loadAll();}
async function deleteStock(id){ if(confirm('Supprimer?')) await fetch('/api/stocks/'+id+'?role=admin',{method:'DELETE'}); loadAll();}
async function deleteClient(id){ if(confirm('Supprimer?')) await fetch('/api/clients/'+id+'?role=admin',{method:'DELETE'}); loadAll();}
async function deleteDevise(id){ if(confirm('Supprimer?')) await fetch('/api/devises/'+id+'?role=admin',{method:'DELETE'}); loadAll();}

function printTable(id){ const prt=document.getElementById(id).outerHTML; const w=window.open('','_blank'); w.document.write(prt); w.print(); }

function loadAll(){ loadTransferts(); loadStocks(); loadClients(); loadDevises(); }
document.getElementById('roleSelect').addEventListener('change', loadAll);
loadAll();

</script>
</body>
</html>
  `);
});

// -------------------- SERVER --------------------
app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
