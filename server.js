const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/test' }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test')
  .then(() => console.log('MongoDB connecté'))
  .catch(console.error);

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
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

function requireLogin(req, res, next){
  if(req.session.userId) return next();
  res.redirect('/login');
}

app.get('/login', (req,res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>Connexion</h2>
<form method="post" action="/login">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<p>Pas de compte ? <a href="/register">Créer un compte</a></p>
</body></html>`);
});

app.post('/login', async (req,res) => {
  const { username, password } = req.body;
  const user = await AuthUser.findOne({ username });
  if(!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(password, user.password);
  if(!match) return res.send("Mot de passe incorrect");
  req.session.userId = user._id;
  res.redirect('/users/choice');
});

app.get('/register', (req,res) => {
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>Créer un compte</h2>
<form method="post" action="/register">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Créer</button>
</form>
<p>Déjà un compte ? <a href="/login">Se connecter</a></p>
</body></html>`);
});

app.post('/register', async (req,res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await new AuthUser({ username, password: hashedPassword }).save();
    res.send("Compte créé ! <a href='/login'>Se connecter</a>");
  } catch(err) {
    res.send("Erreur, nom d'utilisateur déjà pris");
  }
});

app.get('/logout', (req,res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/users', requireLogin, (req,res)=>{
  if(!req.session.formAccess){
    return res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>Accès formulaire</h2>
<form method="post" action="/auth/form">
<input type="password" name="code" placeholder="Code 123" required><br><br>
<button>Valider</button>
</form></body></html>`);
  }
  res.redirect('/users/choice');
});

app.post('/auth/form',(req,res)=>{
  if(req.body.code==='123') req.session.formAccess=true;
  res.redirect('/users/choice');
});

app.post('/auth/list', requireLogin, (req, res) => {
  const code = req.body.code;
  if (code === '147') {
    req.session.listAccess = true;
    res.redirect('/users/all');
  } else {
    res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>Code incorrect</h2>
<a href="/users/all">Retour</a>
</body></html>`);
  }
});

app.get('/users/choice', requireLogin, (req,res)=>{
  if(!req.session.formAccess) return res.redirect('/users');
  res.send(`<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;text-align:center;padding-top:40px;background:#eef2f7}
button{padding:12px 25px;margin:8px;font-size:16px;border:none;color:white;border-radius:5px;cursor:pointer}
#new{background:#007bff} #edit{background:#28a745} #delete{background:#dc3545}
</style></head>
<body>
<h2>Gestion des transferts</h2>
<a href="/users/lookup?mode=new"><button id="new">Nouveau transfert</button></a><br>
<a href="/users/lookup?mode=edit"><button id="edit">Modifier transfert</button></a><br>
<a href="/users/lookup?mode=delete"><button id="delete">Supprimer transfert</button></a><br>
<br><a href="/logout">Déconnexion</a>
</body></html>`);
});

app.get('/users/lookup', requireLogin, (req,res)=>{
  if(!req.session.formAccess) return res.redirect('/users');
  const mode = req.query.mode || 'edit';
  req.session.choiceMode = mode;
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h3>Numéro expéditeur</h3>
<form method="post" action="/users/lookup">
<input name="phone" required><br><br>
<button>Continuer</button>
</form><br><a href="/users/choice">Retour</a>
</body></html>`);
});

app.post('/users/lookup', requireLogin, async (req,res)=>{
  const u = await User.findOne({ senderPhone:req.body.phone }).sort({ createdAt: -1 });
  req.session.prefill = u || { senderPhone: req.body.phone };
  if(req.session.choiceMode === 'new') req.session.editId = null;
  else if(u) req.session.editId = u._id;
  else if(req.session.choiceMode === 'edit') req.session.editId = null;
  else if(req.session.choiceMode === 'delete'){
    if(u){
      await User.findByIdAndDelete(u._id);
      req.session.prefill = null;
      req.session.editId = null;
      return res.send(`<html><body style="text-align:center;padding-top:50px">
Transfert supprimé<br><br><a href="/users/choice">Retour</a></body></html>`);
    } else {
      return res.send(`<html><body style="text-align:center;padding-top:50px">
Aucun transfert trouvé<br><br><a href="/users/choice">Retour</a></body></html>`);
    }
  }
  res.redirect('/users/form');
});

app.get('/users/form', requireLogin, (req,res)=>{
  const u = req.session.prefill || {};
  const isEdit = !!req.session.editId;
  const locations = ['France','Labé','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
  res.send(`<!DOCTYPE html>
<html>
<body style="font-family:Arial">
<form id="form">
<h3>${isEdit?'Modifier transfert':'Nouveau transfert'}</h3>
Expéditeur:<br>
<input id="senderFirstName" value="${u.senderFirstName||''}" placeholder="Prénom">
<input id="senderLastName" value="${u.senderLastName||''}" placeholder="Nom">
<input id="senderPhone" value="${u.senderPhone||''}" required placeholder="Téléphone">
<select id="originLocation">${locations.map(v=>`<option ${u.originLocation===v?'selected':''}>${v}</option>`).join('')}</select><br>
Montant:<br><input id="amount" type="number" value="${u.amount||''}" placeholder="Montant">
Frais:<br><input id="fees" type="number" value="${u.fees||''}" placeholder="Frais">
% Frais:<br><input id="feePercent" type="number" value="${u.feePercent||''}" placeholder="%"><br>
Destinataire:<br>
<input id="receiverFirstName" value="${u.receiverFirstName||''}" placeholder="Prénom">
<input id="receiverLastName" value="${u.receiverLastName||''}" placeholder="Nom">
<input id="receiverPhone" value="${u.receiverPhone||''}" placeholder="Téléphone">
<select id="destinationLocation">${locations.map(v=>`<option ${u.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select><br>
Montant reçu:<br><input id="recoveryAmount" type="number" value="${u.recoveryAmount||''}" readonly><br>
Mode récupération:<br>
<select id="recoveryMode">
<option ${u.recoveryMode==='Espèces'?'selected':''}>Espèces</option>
<option ${u.recoveryMode==='Orange Money'?'selected':''}>Orange Money</option>
<option ${u.recoveryMode==='Wave'?'selected':''}>Wave</option>
<option ${u.recoveryMode==='Produit'?'selected':''}>Produit</option>
<option ${u.recoveryMode==='Service'?'selected':''}>Service</option>
</select><br><br>
<button id="save">${isEdit?'Mettre à jour':'Enregistrer'}</button>
${isEdit?'<button type="button" id="cancel" onclick="cancelTransfer()">Supprimer</button>':''}
<button type="button" onclick="location.href='/logout'">Déconnexion</button>
<p id="message"></p>
</form>
<script>
const amount=document.getElementById('amount');
const fees=document.getElementById('fees');
const recoveryAmount=document.getElementById('recoveryAmount');
function updateRecoveryAmount(){recoveryAmount.value=(+amount.value||0)-(+fees.value||0);}
amount.addEventListener('input',updateRecoveryAmount);
fees.addEventListener('input',updateRecoveryAmount);
const form=document.getElementById('form');
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
  document.getElementById('message').innerText=d.message;
};
function cancelTransfer(){
  if(!confirm('Supprimer ce transfert ?'))return;
  fetch('/users/delete',{method:'POST'}).then(()=>location.href='/users/choice');
}
</script>
</body></html>`);
});

// CRUD POST routes
app.post('/users', requireLogin, async (req,res)=>{
  const code=Math.floor(100000+Math.random()*900000).toString();
  await new User({...req.body, code,status:'actif'}).save();
  res.json({message:'Transfert enregistré | Code '+code});
});
app.post('/users/update', requireLogin, async (req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndUpdate(req.session.editId, req.body);
  req.session.editId=null;
  res.json({message:'Transfert mis à jour'});
});
app.post('/users/delete', requireLogin, async (req,res)=>{
  if(!req.session.editId) return res.status(400).json({message:'Aucun transfert sélectionné'});
  await User.findByIdAndDelete(req.session.editId);
  req.session.editId=null;
  res.json({message:'Transfert supprimé'});
});
app.post('/users/retirer', requireLogin, async (req,res)=>{
  const {id, mode} = req.body;
  if(!["Espèces","Orange Money","Produit","Service"].includes(mode)) return res.status(400).json({message:"Mode invalide"});
  const user = await User.findById(id);
  if(!user) return res.status(404).json({message:"Transfert introuvable"});
  user.recoveryMode = mode;
  user.retraitHistory.push({date: new Date(), mode});
  user.retired = true;
  await user.save();
  res.json({message:`Retrait effectué via ${mode}`, recoveryAmount: user.amount - user.fees});
});

app.get('/users/all', requireLogin, async (req,res)=>{
  if(!req.session.listAccess){
    return res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>Accès liste</h2>
<form method="post" action="/auth/list">
<input type="password" name="code" placeholder="Code 147" required><br><br>
<button>Valider</button>
</form></body></html>`);
  }
  const users = await User.find({}).sort({destinationLocation:1, createdAt:1});
  const grouped = {};
  users.forEach(u=>{
    if(!grouped[u.destinationLocation]) grouped[u.destinationLocation] = [];
    grouped[u.destinationLocation].push(u);
  });
  let html = `<html><body style="font-family:Arial"><h2>Liste des transferts</h2><button onclick="window.location='/users/export/pdf'">Export PDF</button><button onclick="fetch('/logout').then(()=>location.href='/login')">Déconnexion</button>`;
  for(let dest in grouped){
    html+=`<h3>${dest}</h3><table border="1"><tr><th>Expéditeur</th><th>Tél</th><th>Montant</th><th>Frais</th><th>Destinataire</th><th>Montant reçu</th><th>Code</th><th>Date</th><th>Action</th></tr>`;
    grouped[dest].forEach(u=>{
      const isRetired=u.retired;
      html+=`<tr ${isRetired?'style="background:orange"':''}><td>${u.senderFirstName} ${u.senderLastName}</td><td>${u.senderPhone}</td><td>${u.amount}</td><td>${u.fees}</td><td>${u.receiverFirstName} ${u.receiverLastName}</td><td>${u.recoveryAmount}</td><td>${u.code}</td><td>${new Date(u.createdAt).toLocaleString()}</td><td>${isRetired?'Retiré':`<button onclick="retirer('${u._id}',this.parentElement.parentElement)">Retirer</button>`}</td></tr>`;
    });
    html+=`</table>`;
  }
  html+=`<script>
async function retirer(id,row){
  const mode = prompt('Mode de retrait: Espèces / Orange Money / Produit / Service');
  if(!mode) return;
  const res = await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});
  const data = await res.json();
  alert(data.message);
  row.style.background='orange';
  row.querySelector('button').outerHTML='Retiré';
}
</script></body></html>`;
  res.send(html);
});

app.get('/users/export/pdf', requireLogin, async (req,res)=>{
  const users = await User.find({}).sort({destinationLocation:1, createdAt:1});
  const doc = new PDFDocument({size:'A4',margin:30});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
  doc.fontSize(12).text('Liste des transferts', {align:'center'});
  doc.moveDown();
  users.forEach(u=>{
    doc.fontSize(10).text(`${u.senderFirstName} ${u.senderLastName} -> ${u.receiverFirstName} ${u.receiverLastName} | Montant: ${u.amount} | Frais: ${u.fees} | Reçu: ${u.recoveryAmount} | Code: ${u.code} | Dest: ${u.destinationLocation}`);
  });
  doc.end();
  doc.pipe(res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', ()=>console.log(`Serveur en écoute sur ${PORT}`));
