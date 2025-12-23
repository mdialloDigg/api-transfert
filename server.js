/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  amount: Number,
  fees: Number,
  feePercent: Number,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  recoveryAmount: Number,
  recoveryMode: String,
  code: String,
  status: { type: String, default: 'actif' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const authUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

/* ================= AUTH MIDDLEWARE ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.userId) return next();
  res.redirect('/login');
};

const requireListAccess = (req,res,next)=>{
  if(req.session.listAccess) return next();
  res.redirect('/users/all/code');
};

/* ================= AUTH ROUTES ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>🔑 Connexion</h2>
<form method="post">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<p>Pas de compte ? <a href="/register">Créer un compte</a></p>
</body></html>`);
});

app.post('/login',async(req,res)=>{
  const user = await AuthUser.findOne({ username:req.body.username });
  if(!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(req.body.password,user.password);
  if(!match) return res.send("Mot de passe incorrect");
  req.session.userId = user._id;
  res.redirect('/users/choice');
});

app.get('/register',(req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>📝 Créer un compte</h2>
<form method="post">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Créer</button>
</form>
<p>Déjà un compte ? <a href="/login">Se connecter</a></p>
</body></html>`);
});

app.post('/register',async(req,res)=>{
  try{
    await new AuthUser({ username:req.body.username, password: await bcrypt.hash(req.body.password,10) }).save();
    res.send("✅ Compte créé ! <a href='/login'>Se connecter</a>");
  }catch{
    res.send("Erreur, nom d'utilisateur déjà pris");
  }
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= MENU ================= */
app.get('/users/choice', requireLogin,(req,res)=>{
  res.send(`<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;text-align:center;padding-top:40px;background:#eef2f7}
button{padding:12px 25px;margin:8px;font-size:16px;border:none;color:white;border-radius:5px;cursor:pointer}
#new{background:#007bff} #edit{background:#28a745} #delete{background:#dc3545} #list{background:#6c757d}
</style></head>
<body>
<h2>📋 Gestion des transferts</h2>
<a href="/users/lookup?mode=new"><button id="new">💾 Nouveau transfert</button></a><br>
<a href="/users/lookup?mode=edit"><button id="edit">✏️ Modifier transfert</button></a><br>
<a href="/users/lookup?mode=delete"><button id="delete">❌ Supprimer transfert</button></a><br>
<a href="/users/all"><button id="list">📋 Liste des transferts</button></a><br>
<br><a href="/logout">🚪 Déconnexion</a>
</body></html>`);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup', requireLogin,(req,res)=>{
  req.session.choiceMode = req.query.mode || 'edit';
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px;background:#eef2f7">
<h3>📞 Numéro expéditeur</h3>
<form method="post">
<input name="phone" required><br><br>
<button>Continuer</button>
</form><br><a href="/users/choice">🔙 Retour</a>
</body></html>`);
});

app.post('/users/lookup', requireLogin, async(req,res)=>{
  const u = await User.findOne({ senderPhone:req.body.phone }).sort({ createdAt:-1 });
  req.session.prefill = u || { senderPhone:req.body.phone };

  if(req.session.choiceMode==='new') req.session.editId = null;
  else if(u) req.session.editId = u._id;
  else if(req.session.choiceMode==='edit') req.session.editId = null;
  else if(req.session.choiceMode==='delete'){
    if(u){
      await User.findByIdAndDelete(u._id);
      return res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:50px">❌ Transfert supprimé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
    } else return res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:50px">Aucun transfert trouvé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
  }
  res.redirect('/users/form');
});

/* ================= FORMULAIRE ================= */
app.get('/users/form', requireLogin,(req,res)=>{
  const u = req.session.prefill || {};
  const isEdit = !!req.session.editId;
  const locations = ['France','Labé','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

  res.send(`<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#dde5f0;margin:0;padding:0}
form{background:#fff;max-width:950px;margin:20px auto;padding:15px;border-radius:8px}
.container{display:flex;flex-wrap:wrap;gap:15px}
.box{flex:1;min-width:250px;padding:10px;border-radius:6px}
.origin{background:#e3f0ff}
.dest{background:#ffe3e3}
input,select,button{width:100%;padding:9px;margin-top:8px;font-size:14px}
button{border:none;color:white;font-size:15px;border-radius:5px;cursor:pointer}
#save{background:#007bff} #cancel{background:#dc3545} #logout{background:#6c757d}
@media(max-width:600px){.container{flex-direction:column}}
</style>
</head>
<body>
<form id="form">
<h3 style="text-align:center">${isEdit?'✏️ Modifier transfert':'💸 Nouveau transfert'}</h3>
<div class="container">
<div class="box origin"><h4>📤 Expéditeur</h4>
<input id="senderFirstName" value="${u.senderFirstName||''}" placeholder="Prénom">
<input id="senderLastName" value="${u.senderLastName||''}" placeholder="Nom">
<input id="senderPhone" value="${u.senderPhone||''}" required placeholder="Téléphone">
<select id="originLocation">${locations.map(v=>`<option ${u.originLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input id="amount" type="number" value="${u.amount||''}" placeholder="Montant">
<input id="fees" type="number" value="${u.fees||''}" placeholder="Frais">
<input id="feePercent" type="number" value="${u.feePercent||''}" placeholder="% Frais">
</div>
<div class="box dest"><h4>📥 Destinataire</h4>
<input id="receiverFirstName" value="${u.receiverFirstName||''}" placeholder="Prénom">
<input id="receiverLastName" value="${u.receiverLastName||''}" placeholder="Nom">
<input id="receiverPhone" value="${u.receiverPhone||''}" placeholder="Téléphone">
<select id="destinationLocation">${locations.map(v=>`<option ${u.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select>
<input id="recoveryAmount" type="number" value="${u.recoveryAmount||''}" placeholder="Montant reçu" readonly>
<select id="recoveryMode">
<option ${u.recoveryMode==='Espèces'?'selected':''}>Espèces</option>
<option ${u.recoveryMode==='Orange Money'?'selected':''}>Orange Money</option>
<option ${u.recoveryMode==='Wave'?'selected':''}>Wave</option>
<option ${u.recoveryMode==='Produit'?'selected':''}>Produit</option>
<option ${u.recoveryMode==='Service'?'selected':''}>Service</option>
</select>
</div>
</div>
<button id="save">${isEdit?'💾 Mettre à jour':'💾 Enregistrer'}</button>
${isEdit?'<button type="button" id="cancel" onclick="cancelTransfer()">❌ Supprimer</button>':''}
<button type="button" id="logout" onclick="location.href='/logout'">🚪 Déconnexion</button>
<p id="message"></p>
</form>
<script>
const amount = document.getElementById('amount');
const fees = document.getElementById('fees');
const recoveryAmount = document.getElementById('recoveryAmount');
function updateRecoveryAmount(){recoveryAmount.value=(+amount.value||0)-(+fees.value||0);}
amount.addEventListener('input', updateRecoveryAmount);
fees.addEventListener('input', updateRecoveryAmount);

form.onsubmit=async e=>{
e.preventDefault();
const url='${isEdit?'/users/update':'/users'}';
const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({
senderFirstName:senderFirstName.value,
senderLastName:senderLastName.value,
senderPhone:senderPhone.value,
originLocation:originLocation.value,
amount:+amount.value,
fees:+fees.value,
feePercent:+feePercent.value,
receiverFirstName:receiverFirstName.value,
receiverLastName:receiverLastName.value,
receiverPhone:receiverPhone.value,
destinationLocation:destinationLocation.value,
recoveryAmount:+recoveryAmount.value,
recoveryMode:recoveryMode.value
})});
const d=await r.json();
message.innerText=d.message;
};

function cancelTransfer(){
if(!confirm('Voulez-vous supprimer ce transfert ?'))return;
fetch('/users/delete',{method:'POST'}).then(()=>location.href='/users/choice');
}
</script>
</body></html>`);
});

/* ================= CRUD ================= */
app.post('/users', requireLogin, async(req,res)=>{
  const code = Math.floor(100000 + Math.random()*900000).toString();
  await new User({...req.body, code, status:'actif'}).save();
  res.json({message:'✅ Transfert enregistré | Code '+code});
});

app.post('/users/update', requireLogin, async(req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndUpdate(req.session.editId, req.body);
  req.session.editId = null;
  res.json({message:'✏️ Transfert mis à jour'});
});

app.post('/users/delete', requireLogin, async(req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndDelete(req.session.editId);
  req.session.editId = null;
  res.json({message:'❌ Transfert supprimé'});
});

/* ================= RETRAIT ================= */
app.post('/users/retirer', requireLogin, async(req,res)=>{
  const {id,mode} = req.body;
  if(!["Espèces","Orange Money","Produit","Service"].includes(mode)) return res.status(400).json({message:"Mode invalide"});
  const user = await User.findById(id);
  if(!user) return res.status(404).json({message:"Transfert introuvable"});
  user.recoveryMode = mode;
  user.retraitHistory.push({date:new Date(), mode});
  user.retired = true;
  await user.save();
  res.json({message:`💰 Retrait effectué via ${mode}`, recoveryAmount: user.amount - user.fees});
});

/* ================= ACCÈS LISTE ================= */
app.get('/users/all/code', requireLogin,(req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>🔒 Accès liste</h2>
<form method="post">
<input type="password" name="code" placeholder="Code 147" required><br><br>
<button>Valider</button>
</form>
</body></html>`);
});

app.post('/users/all/code', requireLogin,(req,res)=>{
  if(req.body.code==='147'){
    req.session.listAccess=true;
    return res.redirect('/users/all');
  }
  res.send('Code incorrect. <a href="/users/all/code">Réessayer</a>');
});

/* ================= LISTE ================= */
app.get('/users/all', requireLogin, requireListAccess, async(req,res)=>{
  const users = await User.find({}).sort({destinationLocation:1, createdAt:1});
  const grouped = {};
  let totalAmount = 0, totalRecovery = 0, totalFees = 0;
  users.forEach(u=>{
    if(!grouped[u.destinationLocation]) grouped[u.destinationLocation]=[];
    grouped[u.destinationLocation].push(u);
    totalAmount += u.amount||0;
    totalRecovery += u.recoveryAmount||0;
    totalFees += u.fees||0;
  });

  let html = `<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff;margin-bottom:40px}
th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
th{background:#007bff;color:#fff}
.origin{background:#e3f0ff}
.dest{background:#ffe3e3}
.sub{background:#ddd;font-weight:bold}
.total{background:#222;color:#fff;font-weight:bold}
tr.retired{background-color:orange;color:#000;}
button.retirer{padding:5px 10px;border:none;border-radius:4px;background:#28a745;color:#fff;cursor:pointer;}
</style></head><body>
<h2 style="text-align:center">📋 Liste des transferts</h2>
<button onclick="window.location='/users/export/pdf'">📄 Export PDF</button>
<button onclick="fetch('/logout').then(()=>location.href='/login')">🚪 Déconnexion</button>
`;

for(let dest in grouped){
  const list = grouped[dest];
  let subAmount=0, subRecovery=0, subFees=0;
  html += `<h3 style="text-align:center;color:#007bff">Destination: ${dest}</h3><table>
<tr>
<th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th>
<th>Destinataire</th><th>Tél Dest.</th><th>Destination</th>
<th>Montant reçu</th><th>Code</th><th>Date</th><th>Action</th>
</tr>`;
  list.forEach(u=>{
    const isRetired = u.retired;
    subAmount += u.amount||0; subRecovery += u.recoveryAmount||0; subFees += u.fees||0;
    html += `<tr class="${isRetired?'retired':''}">
<td>${u.senderFirstName||''} ${u.senderLastName||''}</td>
<td>${u.senderPhone||''}</td>
<td class="origin">${u.originLocation||''}</td>
<td>${u.amount||0}</td>
<td>${u.fees||0}</td>
<td>${u.receiverFirstName||''} ${u.receiverLastName||''}</td>
<td>${u.receiverPhone||''}</td>
<td class="dest">${u.destinationLocation||''}</td>
<td>${u.recoveryAmount||0}</td>
<td>${u.code||''}</td>
<td>${u.createdAt?new Date(u.createdAt).toLocaleString():''}</td>
<td>${isRetired?'Montant retiré':`<button class="retirer" onclick="retirer('${u._id}',this.parentElement.parentElement)">💰 Retirer</button>`}</td>
</tr>`;
  });
  html += `<tr class="sub"><td colspan="3">Sous-total ${dest}</td><td>${subAmount}</td><td>${subFees}</td><td colspan="2"></td><td></td><td>${subRecovery}</td><td colspan="2"></td><td></td></tr></table>`;
}

html += `<table><tr class="total"><td colspan="3">TOTAL GÉNÉRAL</td><td>${totalAmount}</td><td>${totalFees}</td><td colspan="2"></td><td></td><td>${totalRecovery}</td><td colspan="2"></td><td></td></tr></table>
<script>
async function retirer(id,row){
  const mode = prompt('Mode de retrait: Espèces / Orange Money / Produit / Service');
  if(!mode) return;
  const res = await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
  const data = await res.json();
  alert(data.message);
  row.classList.add('retired');
  row.querySelector('button.retirer').outerHTML='Montant retiré';
}
</script></body></html>`;
res.send(html);
});

/* ================= EXPORT PDF ================= */
app.get('/users/export/pdf', requireLogin, async(req,res)=>{
  const users = await User.find({}).sort({destinationLocation:1, createdAt:1});
  const doc = new PDFDocument({margin:30, size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment;filename=transferts.pdf');
  doc.pipe(res);

  doc.fontSize(18).text('Liste des transferts', {align:'center'});
  doc.moveDown();

  users.forEach(u=>{
    doc.fontSize(12).text(`Expéditeur: ${u.senderFirstName} ${u.senderLastName} | Tél: ${u.senderPhone} | Origine: ${u.originLocation} | Montant: ${u.amount} | Frais: ${u.fees}`);
    doc.text(`Destinataire: ${u.receiverFirstName} ${u.receiverLastName} | Tél: ${u.receiverPhone} | Destination: ${u.destinationLocation}`);
    doc.text(`Montant reçu: ${u.recoveryAmount} | Mode: ${u.recoveryMode} | Code: ${u.code}`);
    doc.text(`Date: ${u.createdAt ? new Date(u.createdAt).toLocaleString() : ''}`);
    doc.moveDown();
  });

  doc.end();
});

/* ================= SERVEUR ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
