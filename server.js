/******************************************************************
 * APP TRANSFERT – VERSION FINALE MODERNE RESPONSIVE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

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
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= LOCATIONS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

// ================= UTILITAIRE =================
async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    code = `${String.fromCharCode(65 + Math.floor(Math.random()*26))}${Math.floor(100 + Math.random()*900)}`;
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#f0f4f8;display:flex;align-items:center;justify-content:center;height:100vh;}
form{background:#fff;padding:40px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
input,button{padding:12px;margin:8px;width:100%;border-radius:6px;border:1px solid #ccc;font-size:16px;}
button{background:#007bff;color:white;border:none;cursor:pointer;font-weight:bold;}
button:hover{background:#0056b3;}
</style></head><body>
<form method="post">
<h2 style="text-align:center;color:#007bff;">Connexion</h2>
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Connexion</button>
</form></body></html>
`);
});

app.post('/login', async(req,res)=>{
  try{
    const { username, password } = req.body;
    const user = await Auth.findOne({ username });
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      await new Auth({ username, password: hashed }).save();
      req.session.user = username;
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = username;
    res.redirect('/menu');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#eef2f7;margin:0;padding:50px;display:flex;flex-direction:column;align-items:center;}
h2{color:#2c7be5;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;width:100%;max-width:600px;}
button{padding:20px;font-size:16px;border:none;border-radius:10px;color:white;cursor:pointer;transition:0.3s;}
.send{background:#007bff;} .send:hover{background:#0056b3;}
.list{background:#28a745;} .list:hover{background:#1e7e34;}
.logout{background:#dc3545;} .logout:hover{background:#a71d2a;}
a{text-decoration:none;width:100%;}
</style></head><body>
<h2>📲 Gestion des transferts</h2>
<div class="grid">
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</div></body></html>
`);
});

// ================= NOUVEAU TRANSFERT =================
app.get('/transferts/new', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
.container{max-width:900px;margin:auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{color:#2c7be5;text-align:center;margin-bottom:30px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:20px;}
label{display:block;margin-bottom:6px;font-weight:bold;color:#555;}
input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
input[readonly]{background:#e9ecef;}
button{width:100%;padding:15px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#218838;}
a{display:inline-block;margin-top:20px;color:#2c7be5;text-decoration:none;font-weight:bold;}
a:hover{text-decoration:underline;}
</style></head><body>
<div class="container">
<h2>➕ Nouveau Transfert</h2>
<form method="post">
<h3>Type de personne</h3>
<select name="userType">
<option>Client</option>
<option>Distributeur</option>
<option>Administrateur</option>
<option>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<div><label>Prénom</label><input name="senderFirstName" required></div>
<div><label>Nom</label><input name="senderLastName" required></div>
<div><label>Téléphone</label><input name="senderPhone" required></div>
<div><label>Origine</label><select name="originLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select></div>
</div>

<h3>Destinataire</h3>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" required></div>
<div><label>Nom</label><input name="receiverLastName" required></div>
<div><label>Téléphone</label><input name="receiverPhone" required></div>
<div><label>Destination</label><select name="destinationLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select></div>
</div>

<h3>Montants & Devise</h3>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" required></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly></div>
<div><label>Code transfert</label><input type="text" id="code" name="code" readonly value="${code}"></div>
<div><label>Devise</label><select name="currency">
<option>GNF</option>
<option>EUR</option>
<option>USD</option>
<option>XOF</option>
</select></div>
</div>

<button>Enregistrer</button>
</form>
<center><a href="/menu">⬅ Retour menu</a></center>
</div>

<script>
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');
function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();
</script>
</body></html>
  `);
});

app.post('/transferts/new', requireLogin, async(req,res)=>{
  try{
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;
    const code = req.body.code || await generateUniqueCode();
    await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= MODIFIER TRANSFERT =================
app.get('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
.container{max-width:900px;margin:auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{color:#2c7be5;text-align:center;margin-bottom:30px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:20px;}
label{display:block;margin-bottom:6px;font-weight:bold;color:#555;}
input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
input[readonly]{background:#e9ecef;}
button{width:100%;padding:15px;background:#007bff;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
a{display:inline-block;margin-top:20px;color:#2c7be5;text-decoration:none;font-weight:bold;}
a:hover{text-decoration:underline;}
</style></head><body>
<div class="container">
<h2>✏️ Modifier Transfert</h2>
<form method="post" action="/transferts/edit/${t._id}">
<h3>Type de personne</h3>
<select name="userType">
<option ${t.userType==='Client'?'selected':''}>Client</option>
<option ${t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<div><label>Prénom</label><input name="senderFirstName" value="${t.senderFirstName}" required></div>
<div><label>Nom</label><input name="senderLastName" value="${t.senderLastName}" required></div>
<div><label>Téléphone</label><input name="senderPhone" value="${t.senderPhone}" required></div>
<div><label>Origine</label><select name="originLocation">
${locations.map(v=>`<option ${v===t.originLocation?'selected':''}>${v}</option>`).join('')}
</select></div>
</div>

<h3>Destinataire</h3>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" value="${t.receiverFirstName}" required></div>
<div><label>Nom</label><input name="receiverLastName" value="${t.receiverLastName}" required></div>
<div><label>Téléphone</label><input name="receiverPhone" value="${t.receiverPhone}" required></div>
<div><label>Destination</label><select name="destinationLocation">
${locations.map(v=>`<option ${v===t.destinationLocation?'selected':''}>${v}</option>`).join('')}
</select></div>
</div>

<h3>Montants & Devise</h3>
<div class="grid">
<div><label>Montant</label><input type="number" name="amount" value="${t.amount}" required></div>
<div><label>Frais</label><input type="number" name="fees" value="${t.fees}" required></div>
<div><label>Devise</label><select name="currency">
<option ${t.currency==='GNF'?'selected':''}>GNF</option>
<option ${t.currency==='EUR'?'selected':''}>EUR</option>
<option ${t.currency==='USD'?'selected':''}>USD</option>
<option ${t.currency==='XOF'?'selected':''}>XOF</option>
</select></div>
<div><label>Code</label><input type="text" name="code" value="${t.code}" readonly></div>
</div>

<button>Enregistrer</button>
</form>
<a href="/transferts/list">⬅ Retour à la liste</a>
</div>
</body></html>
  `);
});

app.post('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  await Transfert.findByIdAndUpdate(req.params.id,{...req.body, amount, fees, recoveryAmount});
  res.redirect('/transferts/list');
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      recoveryMode:req.body.mode,
      $push:{ retraitHistory:{ date: new Date(), mode:req.body.mode }}
    });
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { phone='', currency='' } = req.query;
  let filter = {};
  if(phone) filter.$or=[{senderPhone:{$regex:phone}},{receiverPhone:{$regex:phone}}];
  if(currency) filter.currency = currency;

  const transferts = await Transfert.find(filter).sort({destinationLocation:1});
  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let totalAmountAll=0, totalFeesAll=0, totalReceivedAll=0;

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
h2{color:#2c7be5;text-align:center;}
form,table{width:100%;max-width:1000px;margin:auto;}
table{border-collapse:collapse;margin-top:10px;}
th,td{border:1px solid #ccc;padding:8px;text-align:center;font-size:14px;}
th{background:#007bff;color:white;}
button{padding:6px 10px;margin:2px;border:none;border-radius:6px;cursor:pointer;font-size:12px;}
button.delete{background:#dc3545;color:white;}
button.print{background:#17a2b8;color:white;}
button.retire{background:#28a745;color:white;}
a{margin:2px;text-decoration:none;}
.retired{background:#e0e0e0;}
.filter{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;justify-content:center;}
input,select{padding:8px;border-radius:6px;border:1px solid #ccc;}
</style></head><body>
<h2>📋 Liste des transferts</h2>
<div class="filter">
<form method="get" style="display:flex;gap:10px;flex-wrap:wrap;">
<input type="text" name="phone" placeholder="Filtrer par téléphone" value="${phone}">
<select name="currency">
<option value="">Toutes devises</option>
<option ${currency==='GNF'?'selected':''}>GNF</option>
<option ${currency==='EUR'?'selected':''}>EUR</option>
<option ${currency==='USD'?'selected':''}>USD</option>
<option ${currency==='XOF'?'selected':''}>XOF</option>
</select>
<button type="submit">Filtrer</button>
<a href="/transferts/list"><button type="button">Réinitialiser</button></a>
</form>
</div>
<a href="/menu">⬅ Menu</a> | <a href="/transferts/new">➕ Nouveau</a><hr>`;

for(let dest in grouped){
  let ta=0, tf=0, tr=0;
  html+=`<h3 style="color:#007bff;">Destination: ${dest}</h3>`;
  html+=`<table><tr>
<th>Expéditeur</th><th>Téléphone</th><th>Destinataire</th><th>Téléphone</th>
<th>Montant</th><th>Frais</th><th>À recevoir</th><th>Devise</th><th>Code</th><th>Actions</th>
</tr>`;
  grouped[dest].forEach(t=>{
    ta+=t.amount; tf+=t.fees; tr+=t.recoveryAmount;
    totalAmountAll+=t.amount; totalFeesAll+=t.fees; totalReceivedAll+=t.recoveryAmount;
    html+=`<tr class="${t.retired?'retired':''}">
<td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.senderPhone}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.receiverPhone}</td>
<td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.code}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️</button></a>
<form method="post" action="/transferts/retirer" style="display:inline;">
<input type="hidden" name="id" value="${t._id}">
<select name="mode" required><option>Espèces</option><option>Virement</option></select>
<button class="retire">💵 Retirer</button>
</form>
</td>
</tr>`;
  });
  html+=`<tr style="font-weight:bold;"><td colspan="4">Totaux</td><td>${ta}</td><td>${tf}</td><td>${tr}</td><td colspan="3"></td></tr>`;
  html+=`</table><br>`;
}
html+=`<h3 style="color:#2c7be5;">Totaux généraux: Montant=${totalAmountAll}, Frais=${totalFeesAll}, À recevoir=${totalReceivedAll}</h3>`;
html+=`</body></html>`;
res.send(html);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`));
