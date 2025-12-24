/******************************************************************
 * APPLICATION DE TRANSFERT – VERSION FINALE PRODUCTION
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert_final_prod')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: {
    type: String,
    enum: ['Client','Distributeur','Administrateur','Agence de transfert'],
    required: true
  },

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

  recoveryMode: String,
  retired: { type: Boolean, default: false },

  code: String,
  createdAt: { type: Date, default: Date.now }
});

const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= AUTH ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:80px}
form{background:#fff;padding:20px;display:inline-block;border-radius:8px}
input,button{padding:10px;margin:5px;width:220px}
button{background:#007bff;color:white;border:none}
</style></head>
<body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
</body></html>
`);
});

app.post('/login',async(req,res)=>{
let u = await Auth.findOne({username:req.body.username});
if(!u){
  u = await new Auth({
    username:req.body.username,
    password:bcrypt.hashSync(req.body.password,10)
  }).save();
}
if(!bcrypt.compareSync(req.body.password,u.password)) return res.send('Mot de passe incorrect');
req.session.user = u.username;
res.redirect('/menu');
});

/* ================= MENU ================= */
app.get('/menu', requireLogin,(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px}
button{width:300px;padding:15px;margin:10px;font-size:16px;border:none;border-radius:6px;color:white}
.send{background:#007bff}
.list{background:#28a745}
.logout{background:#000}
</style></head>
<body>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Retrait</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>
`);
});

/* ================= FORMULAIRE ================= */
app.get('/transferts/new', requireLogin,(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#dde5f0}
form{background:#fff;width:900px;margin:20px auto;padding:20px;border-radius:8px}
h3{background:#007bff;color:white;padding:8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
input,select,button{padding:8px}
button{background:#28a745;color:white;border:none}
</style></head>
<body>

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
<input name="senderFirstName" placeholder="Prénom">
<input name="senderLastName" placeholder="Nom">
<input name="senderPhone" placeholder="Téléphone">
<input name="originLocation" placeholder="Origine">
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" placeholder="Prénom">
<input name="receiverLastName" placeholder="Nom">
<input name="receiverPhone" placeholder="Téléphone">
<input name="destinationLocation" placeholder="Destination">
</div>

<h3>Montants</h3>
<div class="grid">
<input name="amount" type="number" placeholder="Montant">
<input name="fees" type="number" placeholder="Frais">
</div>

<br>
<button>Enregistrer</button>
</form>

<center><a href="/menu">⬅ Retour menu</a></center>
</body></html>
`);
});

app.post('/transferts/new', requireLogin, async(req,res)=>{
const amount = Number(req.body.amount||0);
const fees = Number(req.body.fees||0);

await new Transfert({
  ...req.body,
  amount,
  fees,
  recoveryAmount: amount - fees,
  code: Math.floor(100000+Math.random()*900000)
}).save();

res.redirect('/transferts/list');
});

/* ================= LISTE ================= */
app.get('/transferts/list', requireLogin, async(req,res)=>{
const transferts = await Transfert.find().sort({destinationLocation:1});

let grouped = {};
transferts.forEach(t=>{
  if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[];
  grouped[t.destinationLocation].push(t);
});

let html = `
<html><head><style>
body{font-family:Arial;background:#f4f6f9}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff}
th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
th{background:#007bff;color:white}
.retired{background:#ffe0a3}
.total{background:#222;color:white;font-weight:bold}
</style></head><body>
<h2 style="text-align:center">📋 Liste des transferts</h2>
<a href="/menu">⬅ Menu</a> | <a href="/transferts/pdf">📄 PDF</a>
<hr>
`;

for(let dest in grouped){
  let ta=0,tf=0,tr=0;

  html+=`<h3 style="text-align:center">Destination : ${dest}</h3><table>
<tr>
<th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th><th>Reçu</th>
<th>Destinataire</th><th>Tél</th><th>Statut</th><th>Action</th>
</tr>`;

  grouped[dest].forEach(t=>{
    ta+=t.amount; tf+=t.fees; tr+=t.recoveryAmount;

    html+=`
<tr class="${t.retired?'retired':''}">
<td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.recoveryAmount}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>${t.retired?'—':`
<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<select name="mode">
<option>Espèces</option>
<option>Orange Money</option>
<option>Wave</option>
</select>
<button>Retirer</button>
</form>`}</td>
</tr>`;
  });

  html+=`<tr class="total">
<td colspan="4">TOTAL ${dest}</td>
<td>${ta}</td><td>${tf}</td><td>${tr}</td>
<td colspan="4"></td>
</tr></table><br>`;
}

html+=`</body></html>`;
res.send(html);
});

/* ================= RETRAIT ================= */
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
await Transfert.findByIdAndUpdate(req.body.id,{
  retired:true,
  recoveryMode:req.body.mode
});
res.redirect('/transferts/list');
});

/* ================= PDF ================= */
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
const list = await Transfert.find().sort({destinationLocation:1});
const doc = new PDFDocument({margin:30});
res.setHeader('Content-Type','application/pdf');
res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
doc.pipe(res);

doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'});
doc.moveDown();

list.forEach(t=>{
doc.fontSize(10)
.text(`Type: ${t.userType}`)
.text(`Origine: ${t.originLocation} → ${t.destinationLocation}`)
.text(`Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`)
.text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`)
.text(`Montant: ${t.amount} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount}`)
.text(`Statut: ${t.retired?'Retiré':'Non retiré'} | Mode: ${t.recoveryMode||'-'} | Code: ${t.code}`);
doc.moveDown();
});

doc.end();
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>{
req.session.destroy(()=>res.redirect('/login'));
});

/* ================= SERVER ================= */
app.listen(3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
