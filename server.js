const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

// ---------- MONGODB CONNECTION ----------
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri).then(() => console.log('✅ MongoDB connecté')).catch(console.error);

// ---------- SCHEMAS ----------
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], required: true },
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
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  deposant: String,
  telephone: String,
  devise: { type: String, enum: ['GNF','EUR','USD','XOF'] },
  montant: Number,
  lieu: String,
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum: ['admin','agent'], default: 'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

// ---------- UTILITAIRES ----------
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    code = String.fromCharCode(65+Math.floor(Math.random()*26)) + Math.floor(100+Math.random()*900);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
  if(username==='admin2') return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ---------- LOGIN ----------
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:#f7f7f7;display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:30px;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);width:90%;max-width:360px;text-align:center;}
  .login-container h2{color:#ff8c42;margin-bottom:20px;}
  .login-container input{width:100%;padding:12px;margin:8px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:12px;width:100%;border:none;border-radius:10px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
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
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('❌ Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ---------- TRANSFERTS ----------
// Formulaire
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({ code:req.query.code }) : null;
  const code = t ? t.code : await generateUniqueCode();
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;margin:0;padding:10px;background:#f0f4f8;}
.container{max-width:900px;margin:auto;padding:20px;background:white;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
form{display:grid;gap:12px;}
label{font-weight:bold;}
input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
input[readonly]{background:#e9ecef;}
button{padding:15px;background:#ff8c42;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;}
button:hover{background:#e67300;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;}
a{display:inline-block;margin-top:10px;color:#007bff;text-decoration:none;}
</style></head><body>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<div class="grid">
<div><label>Prénom Expéditeur</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
<div><label>Nom Expéditeur</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
<div><label>Téléphone Expéditeur</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
<div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
<div><label>Prénom Destinataire</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
<div><label>Nom Destinataire</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
<div><label>Téléphone Destinataire</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
<div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
<div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
<div><label>Montant Reçu</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
<div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
<div><label>Code</label><input type="text" name="code" readonly value="${code}"></div>
<div><label>Mode Retrait</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select></div>
</div>
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

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({ code });
  if(existing) await Transfert.findByIdAndUpdate(existing._id, {...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// Liste Transferts mobile-friendly avec AJAX
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f4f6f9;margin:0;padding:10px;}
table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
th{background:#ff8c42;color:white;}
button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
.modify{background:#28a745;}
.delete{background:#dc3545;}
a{margin-right:10px;text-decoration:none;color:#007bff;}
</style></head><body>`;
html+='<h2>📋 Liste des transferts</h2><a href="/transferts/form">➕ Nouveau</a><a href="/stocks/list">📦 Stocks</a><a href="/logout">🚪 Déconnexion</a><table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
transferts.forEach(t=>{
  html+=`<tr data-id="${t._id}"><td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td><td>
    <a href="/transferts/form?code=${t.code}"><button class="modify">✏️ Modifier</button></a>
  </td></tr>`;
});
html+='</tbody></table></body></html>';
res.send(html);
});

// ---------- STOCKS ----------
// Formulaire et liste avec AJAX et mobile-friendly
app.get('/stocks/form', requireLogin, async(req,res)=>{
  const s = req.query.id ? await Stock.findById(req.query.id) : null;
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
.container{max-width:500px;margin:auto;padding:20px;background:white;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
form{display:grid;gap:12px;}
label{font-weight:bold;}
input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
button{padding:12px;background:#ff8c42;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;}
button:hover{background:#e67300;}
a{display:inline-block;margin-top:10px;color:#007bff;text-decoration:none;}
</style></head><body>
<div class="container">
<h2>${s?'✏️ Modifier':'➕ Nouveau'} Stock</h2>
<form method="post">
<input type="hidden" name="id" value="${s?s._id:''}">
<label>Nom du déposant</label><input name="deposant" required value="${s?s.deposant:''}">
<label>Téléphone</label><input name="telephone" required value="${s?s.telephone:''}">
<label>Devise</label><select name="devise">${currencies.map(c=>`<option ${s&&s.devise===c?'selected':''}>${c}</option>`).join('')}</select>
<label>Montant</label><input type="number" name="montant" required value="${s?s.montant:''}">
<label>Lieu de dépôt</label><input name="lieu" required value="${s?s.lieu:''}">
<button>Valider</button>
</form>
<a href="/stocks/list">⬅ Retour liste</a>
</div></body></html>`);
});

app.post('/stocks/form', requireLogin, async(req,res)=>{
  const {id,deposant,telephone,devise,montant,lieu} = req.body;
  if(id) await Stock.findByIdAndUpdate(id,{deposant,telephone,devise,montant:Number(montant),lieu});
  else await new Stock({deposant,telephone,devise,montant:Number(montant),lieu}).save();
  res.redirect('/stocks/list');
});

app.get('/stocks/list', requireLogin, async(req,res)=>{
  const stocks = await Stock.find().sort({createdAt:-1});
  let html='<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:10px;}table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}th{background:#ff8c42;color:white;}button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}.modify{background:#28a745;}.delete{background:#dc3545;}a{margin-right:10px;text-decoration:none;color:#007bff;}</style></head><body>';
  html+='<h2>📋 Liste des stocks</h2><a href="/stocks/form">➕ Nouveau Stock</a><a href="/transferts/list">📋 Transferts</a><a href="/logout">🚪 Déconnexion</a><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Devise</th><th>Montant</th><th>Lieu</th><th>Date</th><th>Actions</th></tr></thead><tbody>';
  stocks.forEach(s=>{
    html+=`<tr data-id="${s._id}"><td>${s.deposant}</td><td>${s.telephone}</td><td>${s.devise}</td><td>${s.montant}</td><td>${s.lieu}</td><td>${s.createdAt.toLocaleString()}</td><td>
      <a href="/stocks/form?id=${s._id}"><button class="modify">✏️ Modifier</button></a>
      <button class="delete">❌ Supprimer</button>
    </td></tr>`;
  });
  html+='</tbody></table><script>
  async function postData(url,data){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});}
  document.querySelectorAll(".delete").forEach(btn=>btn.onclick=async()=>{
    if(confirm("❌ Confirmer la suppression ?")){
      const tr=btn.closest("tr");
      await postData("/stocks/delete",{id:tr.dataset.id});
      tr.remove();
    }
  });
  </script></body></html>';
  res.send(html);
});

app.post('/stocks/delete', requireLogin, async(req,res)=>{
  await Stock.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ---------- SERVEUR ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`));
