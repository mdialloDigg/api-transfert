/******************************************************************
 * APP TRANSFERT – DASHBOARD MODERNE (VERSION FINALE STABLE)
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
  saveUninitialized: true
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= CONSTANTES ================= */
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['EUR','USD','GNF','XOF','GBP','CHF'];

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType:String,

  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,

  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,

  currency:String,

  amount:Number,
  fees:Number,
  recoveryAmount:Number,

  recoveryMode:String,
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},

  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const Auth = mongoose.model('Auth',new mongoose.Schema({
  username:String,
  password:String
}));

/* ================= UTILS ================= */
async function generateUniqueCode(){
  let code,exists=true;
  while(exists){
    code=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists=await Transfert.findOne({code});
  }
  return code;
}
const requireLogin=(req,res,next)=>req.session.user?next():res.redirect('/login');

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.2);display:inline-block}
input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc}
button{background:#007bff;color:#fff;border:none;font-weight:bold;cursor:pointer}
button:hover{background:#0056b3}
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
  const {username,password}=req.body;
  let user=await Auth.findOne({username});
  if(!user){
    user=new Auth({username,password:bcrypt.hashSync(password,10)});
    await user.save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/menu');
});

/* ================= MENU ================= */
app.get('/menu',requireLogin,(req,res)=>{
res.send(`
<html><body style="font-family:Arial;text-align:center;background:#eef2f7;padding-top:50px">
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/phone"><button>➕ Envoyer de l'argent</button></a><br><br>
<a href="/transferts/list"><button>📋 Liste / Historique</button></a><br><br>
<a href="/logout"><button>🚪 Déconnexion</button></a>
</body></html>
`);
});

/* ================= TELEPHONE AVANT ================= */
app.get('/transferts/phone',requireLogin,(req,res)=>{
res.send(`
<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h2>📞 Téléphone expéditeur</h2>
<form method="get" action="/transferts/new">
<input name="phone" placeholder="Numéro" required>
<button>Continuer</button>
</form>
</body></html>
`);
});

/* ================= NOUVEAU TRANSFERT ================= */
app.get('/transferts/new',requireLogin,async(req,res)=>{
const code=await generateUniqueCode();
res.send(`
<html><body style="font-family:Arial">
<h2>➕ Nouveau Transfert</h2>
<form method="post">
<input name="senderPhone" value="${req.query.phone||''}" readonly><br>
<select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select><br>
<input name="senderFirstName" placeholder="Prénom expéditeur" required><br>
<input name="senderLastName" placeholder="Nom expéditeur" required><br>
<select name="originLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select><br>
<input name="receiverFirstName" placeholder="Prénom destinataire" required><br>
<input name="receiverLastName" placeholder="Nom destinataire" required><br>
<input name="receiverPhone" placeholder="Téléphone destinataire" required><br>
<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select><br>
<input type="number" name="amount" placeholder="Montant" required><br>
<input type="number" name="fees" placeholder="Frais" required><br>
<input name="code" value="${code}" readonly><br>
<button>Enregistrer</button>
</form>
<a href="/menu">⬅ Menu</a>
</body></html>
`);
});

app.post('/transferts/new',requireLogin,async(req,res)=>{
  const a=+req.body.amount,f=+req.body.fees;
  await new Transfert({...req.body,amount:a,fees:f,recoveryAmount:a-f}).save();
  res.redirect('/transferts/list');
});

/* ================= LISTE ================= */
app.get('/transferts/list',requireLogin,async(req,res)=>{
const list=await Transfert.find();
res.send(`
<html><body style="font-family:Arial">
<h2>Liste des transferts</h2>
<a href="/menu">⬅ Menu</a> | <a href="/transferts/pdf">📄 PDF</a><hr>
<table border="1" width="100%">
<tr><th>Code</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th></tr>
${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')"><button>❌</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button>🖨️</button></a>
</td>
</tr>`).join('')}
</table>
</body></html>
`);
});

/* ================= TICKET ================= */
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`
<html><body onload="window.print()" style="width:300px;font-family:Arial">
<h3>Transfert</h3>
Code: ${t.code}<br>
Montant: ${t.amount} ${t.currency}
</body></html>
`);
});

/* ================= PDF ================= */
app.get('/transferts/pdf',requireLogin,async(req,res)=>{
const list=await Transfert.find();
const doc=new PDFDocument();
res.setHeader('Content-Type','application/pdf');
doc.pipe(res);
doc.text('RAPPORT TRANSFERTS\n');
list.forEach(t=>doc.text(`${t.code} - ${t.amount} ${t.currency}`));
doc.end();
});

/* ================= DELETE ================= */
app.get('/transferts/delete/:id',requireLogin,async(req,res)=>{
await Transfert.findByIdAndDelete(req.params.id);
res.redirect('/transferts/list');
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= SERVER ================= */
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Serveur prêt'));
