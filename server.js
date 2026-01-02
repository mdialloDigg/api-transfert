const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'secretkey', resave: false, saveUninitialized: true }));

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/transferts', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async ()=>{
  const count = await User.countDocuments();
  if(count===0){
    await User.create({username:'a',password:'a',role:'a'});
    await User.create({username:'admin2',password:'admin2',role:'admin2'});
  }
}).catch(err=>console.error(err));

const UserSchema = new mongoose.Schema({ username: String, password: String, role: String });
const User = mongoose.model('User', UserSchema);

const TransfertSchema = new mongoose.Schema({
  code: String, senderFirstName: String, senderLastName: String, senderPhone: String,
  originLocation: String, destinationLocation: String, amount: Number, currency: String, retired: Boolean
});
const Transfert = mongoose.model('Transfert', TransfertSchema);

const StockSchema = new mongoose.Schema({
  product: String, quantity: Number, location: String
});
const Stock = mongoose.model('Stock', StockSchema);

function auth(req,res,next){ if(req.session.user) next(); else res.redirect('/login'); }
function checkRole(req,res,next){ if(req.session.user.role==='a' || req.session.user.role==='admin2') next(); else res.send('Accès refusé'); }

app.get('/login',(req,res)=>{
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0}form{background:#fff;padding:20px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1);width:300px}input{width:100%;padding:10px;margin:5px 0;border:1px solid #ccc;border-radius:5px}button{width:100%;padding:10px;background:#007bff;color:#fff;border:none;border-radius:5px;cursor:pointer}button:hover{background:#0056b3}</style>
</head><body>
<form method="POST" action="/login">
<input type="text" name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button type="submit">Se connecter</button>
</form>
</body></html>`);
});

app.post('/login', async (req,res)=>{
  const user = await User.findOne({ username:req.body.username, password:req.body.password });
  if(user){ req.session.user=user; res.redirect('/transferts'); } else res.send('Utilisateur ou mot de passe incorrect'); 
});

app.get('/logout',(req,res)=>{ req.session.destroy(); res.redirect('/login'); });

app.get('/transferts', auth, (req,res)=>{
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transferts</title>
<style>body{font-family:sans-serif;margin:0;padding:0;background:#f9f9f9}header{padding:10px;background:#007bff;color:#fff;display:flex;justify-content:space-between;align-items:center}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:5px;text-align:center}th{background:#e9e9e9}button{padding:5px 10px;margin:2px;border:none;border-radius:5px;cursor:pointer}button:hover{opacity:0.8}input{padding:5px;margin:5px}@media(max-width:600px){table,thead,tbody,th,td,tr{display:block}th{display:none}td{border:none;position:relative;padding-left:50%}td::before{position:absolute;left:10px;width:45%;white-space:nowrap}}</style>
</head><body>
<header>
<h2>Transferts</h2>
<div>
<input type="text" id="search" placeholder="Recherche">
<button onclick="window.location='/transferts/new'">Nouveau</button>
<button onclick="window.location='/stock'">Stock</button>
<button onclick="window.print()">Imprimer</button>
<button onclick="window.location='/logout'">Déconnexion</button>
</div>
</header>
<table id="transfertTable">
<thead>
<tr><th>Code</th><th>Prénom</th><th>Nom</th><th>Téléphone</th><th>Origine</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Retiré</th><th>Actions</th></tr>
</thead>
<tbody></tbody>
<tfoot id="totals"></tfoot>
</table>
<script>
async function loadTransferts(){
  const res = await fetch('/api/transferts');
  const data = await res.json();
  const tbody = document.querySelector('tbody');
  tbody.innerHTML='';
  data.transferts.forEach(t=>{
    let row=document.createElement('tr');
    row.innerHTML=\`<td>\${t.code}</td><td>\${t.senderFirstName}</td><td>\${t.senderLastName}</td><td>\${t.senderPhone}</td><td>\${t.originLocation}</td><td>\${t.destinationLocation}</td><td>\${t.amount}</td><td>\${t.currency}</td><td>\${t.retired?'Oui':'Non'}</td><td>\${t.canEdit?'<button onclick="edit(\\'\${t._id}\\')">Modifier</button><button onclick="suppr(\\'\${t._id}\\')">Supprimer</button>':''}</td>\`;
    tbody.appendChild(row);
  });
  const tf = document.getElementById('totals'); tf.innerHTML='';
  for(const k in data.totals){
    let [dest,curr]=k.split('_');
    let tr=document.createElement('tr');
    tr.innerHTML=\`<td colspan="5">Total \${dest}</td><td colspan="2">\${data.totals[k]}</td><td>\${curr}</td><td colspan="2"></td>\`;
    tf.appendChild(tr);
  }
}
function edit(id){ window.location='/transferts/edit/'+id; }
async function suppr(id){ if(confirm('Supprimer ?')){ await fetch('/api/transferts/'+id,{method:'DELETE'}); loadTransferts(); }}
document.getElementById('search').addEventListener('input',async e=>{
  const val=e.target.value.toLowerCase();
  const rows=document.querySelectorAll('tbody tr');
  rows.forEach(r=>r.style.display=r.textContent.toLowerCase().includes(val)?'':'none');
});
loadTransferts();
</script>
</body></html>`);
});

// --- FORMULAIRE TRANSFERT ---
app.get('/transferts/new', auth, checkRole, (req,res)=>res.redirect('/transferts/form'));
app.get('/transferts/edit/:id', auth, checkRole, (req,res)=>res.redirect('/transferts/form?id='+req.params.id));
app.get('/transferts/form', auth, (req,res)=>{
  const id = req.query.id || '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formulaire Transfert</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0}form{background:#fff;padding:20px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1);width:300px}input,select{width:100%;padding:10px;margin:5px 0;border:1px solid #ccc;border-radius:5px}button{width:100%;padding:10px;background:#007bff;color:#fff;border:none;border-radius:5px;cursor:pointer}button:hover{background:#0056b3}</style>
</head><body>
<form id="form">
<input type="hidden" id="id" value="${id}">
<input type="text" id="code" placeholder="Code" required>
<input type="text" id="senderFirstName" placeholder="Prénom" required>
<input type="text" id="senderLastName" placeholder="Nom" required>
<input type="text" id="senderPhone" placeholder="Téléphone" required>
<input type="text" id="originLocation" placeholder="Origine" required>
<input type="text" id="destinationLocation" placeholder="Destination" required>
<input type="number" id="amount" placeholder="Montant" required>
<input type="text" id="currency" placeholder="Devise" required>
<select id="retired"><option value="false">Non</option><option value="true">Oui</option></select>
<button type="submit">Valider</button>
<button type="button" onclick="window.location='/transferts'">Retour</button>
</form>
<script>
async function save(e){
  e.preventDefault();
  const id=document.getElementById('id').value;
  const data={
    code:document.getElementById('code').value,
    senderFirstName:document.getElementById('senderFirstName').value,
    senderLastName:document.getElementById('senderLastName').value,
    senderPhone:document.getElementById('senderPhone').value,
    originLocation:document.getElementById('originLocation').value,
    destinationLocation:document.getElementById('destinationLocation').value,
    amount:Number(document.getElementById('amount').value),
    currency:document.getElementById('currency').value,
    retired:document.getElementById('retired').value==='true'
  };
  if(id){ await fetch('/api/transferts/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  else{ await fetch('/api/transferts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  window.location='/transferts';
}
document.getElementById('form').addEventListener('submit',save);
if('${id}'){
  fetch('/api/transferts').then(r=>r.json()).then(data=>{
    const t=data.transferts.find(t=>t._id==='${id}');
    if(t){
      document.getElementById('code').value=t.code;
      document.getElementById('senderFirstName').value=t.senderFirstName;
      document.getElementById('senderLastName').value=t.senderLastName;
      document.getElementById('senderPhone').value=t.senderPhone;
      document.getElementById('originLocation').value=t.originLocation;
      document.getElementById('destinationLocation').value=t.destinationLocation;
      document.getElementById('amount').value=t.amount;
      document.getElementById('currency').value=t.currency;
      document.getElementById('retired').value=t.retired.toString();
    }
  });
}
</script>
</body></html>`);
});

// --- STOCK ---
app.get('/stock', auth, (req,res)=>{
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stock</title>
<style>body{font-family:sans-serif;margin:0;padding:0;background:#f9f9f9}header{padding:10px;background:#007bff;color:#fff;display:flex;justify-content:space-between;align-items:center}table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:5px;text-align:center}th{background:#e9e9e9}button{padding:5px 10px;margin:2px;border:none;border-radius:5px;cursor:pointer}button:hover{opacity:0.8}input{padding:5px;margin:5px}@media(max-width:600px){table,thead,tbody,th,td,tr{display:block}th{display:none}td{border:none;position:relative;padding-left:50%}td::before{position:absolute;left:10px;width:45%;white-space:nowrap}}</style>
</head><body>
<header>
<h2>Stock</h2>
<div>
<button onclick="window.location='/stock/new'">Nouveau</button>
<button onclick="window.location='/transferts'">Retour</button>
<button onclick="window.print()">Imprimer</button>
</div>
</header>
<table id="stockTable">
<thead><tr><th>Produit</th><th>Quantité</th><th>Emplacement</th><th>Actions</th></tr></thead>
<tbody></tbody>
</table>
<script>
async function loadStock(){
  const res = await fetch('/api/stock');
  const data = await res.json();
  const tbody = document.querySelector('tbody');
  tbody.innerHTML='';
  data.forEach(s=>{
    let row=document.createElement('tr');
    row.innerHTML=\`<td>\${s.product}</td><td>\${s.quantity}</td><td>\${s.location}</td><td><button onclick="edit('\${s._id}')">Modifier</button><button onclick="suppr('\${s._id}')">Supprimer</button></td>\`;
    tbody.appendChild(row);
  });
}
function edit(id){ window.location='/stock/form?id='+id; }
async function suppr(id){ if(confirm('Supprimer ?')){ await fetch('/api/stock/'+id,{method:'DELETE'}); loadStock(); }}
loadStock();
</script>
</body></html>`);
});

app.get('/stock/new', auth, checkRole, (req,res)=>res.redirect('/stock/form'));
app.get('/stock/form', auth, checkRole, (req,res)=>{
  const id=req.query.id||'';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formulaire Stock</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f0f0}form{background:#fff;padding:20px;border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1);width:300px}input{width:100%;padding:10px;margin:5px 0;border:1px solid #ccc;border-radius:5px}button{width:100%;padding:10px;background:#007bff;color:#fff;border:none;border-radius:5px;cursor:pointer}button:hover{background:#0056b3}</style>
</head><body>
<form id="form">
<input type="hidden" id="id" value="${id}">
<input type="text" id="product" placeholder="Produit" required>
<input type="number" id="quantity" placeholder="Quantité" required>
<input type="text" id="location" placeholder="Emplacement" required>
<button type="submit">Valider</button>
<button type="button" onclick="window.location='/stock'">Retour</button>
</form>
<script>
async function save(e){
  e.preventDefault();
  const id=document.getElementById('id').value;
  const data={
    product:document.getElementById('product').value,
    quantity:Number(document.getElementById('quantity').value),
    location:document.getElementById('location').value
  };
  if(id){ await fetch('/api/stock/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  else{ await fetch('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  window.location='/stock';
}
document.getElementById('form').addEventListener('submit',save);
if('${id}'){
  fetch('/api/stock').then(r=>r.json()).then(data=>{
    const s=data.find(s=>s._id==='${id}');
    if(s){
      document.getElementById('product').value=s.product;
      document.getElementById('quantity').value=s.quantity;
      document.getElementById('location').value=s.location;
    }
  });
}
</script>
</body></html>`);
});

// --- API ---
app.get('/api/transferts', auth, async (req,res)=>{
  const transferts = await Transfert.find();
  let totals = {};
  transferts.forEach(t=>{
    let key=t.destinationLocation+'_'+t.currency;
    totals[key]=(totals[key]||0)+t.amount;
    t.canEdit = req.session.user.role==='a' || req.session.user.role==='admin2';
  });
  res.json({ transferts, totals });
});
app.post('/api/transferts', auth, checkRole, async (req,res)=>{ const t=new Transfert(req.body); await t.save(); res.json({success:true}); });
app.put('/api/transferts/:id', auth, checkRole, async (req,res)=>{ await Transfert.findByIdAndUpdate(req.params.id, req.body); res.json({success:true}); });
app.delete('/api/transferts/:id', auth, checkRole, async (req,res)=>{ await Transfert.findByIdAndDelete(req.params.id); res.json({success:true}); });

app.get('/api/stock', auth, async (req,res)=>{ const s = await Stock.find(); res.json(s); });
app.post('/api/stock', auth, checkRole, async (req,res)=>{ const s = new Stock(req.body); await s.save(); res.json({success:true}); });
app.put('/api/stock/:id', auth, checkRole, async (req,res)=>{ await Stock.findByIdAndUpdate(req.params.id, req.body); res.json({success:true}); });
app.delete('/api/stock/:id', auth, checkRole, async (req,res)=>{ await Stock.findByIdAndDelete(req.params.id); res.json({success:true}); });

app.listen(port,'0.0.0.0',()=>console.log(`Serveur lancé sur http://0.0.0.0:${port}`));
