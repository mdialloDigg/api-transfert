/******************************************************************
 * APP TRANSFERT – VERSION FINALE
 * ✔ Design original conservé
 * ✔ Code structuré et commenté
 * ✔ Téléphone avant envoi
 * ✔ Devise en liste déroulante
 * ✔ Modifier / Supprimer fonctionnels
 * ✔ Ticket impression + PDF
 ******************************************************************/

/* ================= IMPORTS ================= */
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
const currencies = ['EUR','USD','GBP','XOF','GNF','CHF'];

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: String,

  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,

  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,

  currency: { type:String, default:'EUR' },

  amount: Number,
  fees: Number,
  recoveryAmount: Number,

  recoveryMode: String,
  retraitHistory: [{ date:Date, mode:String }],
  retired: { type:Boolean, default:false },

  code: { type:String, unique:true },
  createdAt: { type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.2);display:inline-block;}
input,button{padding:12px;margin:8px;width:250px}
button{background:#007bff;color:#fff;border:none;border-radius:6px}
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

app.post('/login', async(req,res)=>{
  const { username,password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){
    user = await new Auth({ username, password:bcrypt.hashSync(password,10) }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/menu');
});

/* ================= MENU ================= */
app.get('/menu',requireLogin,(req,res)=>{
res.send(`
<html><body style="text-align:center;font-family:Arial">
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/phone"><button>➕ Envoyer de l'argent</button></a><br><br>
<a href="/transferts/list"><button>📋 Liste / Historique</button></a><br><br>
<a href="/logout"><button>🚪 Déconnexion</button></a>
</body></html>
`);
});

/* ================= ETAPE TELEPHONE ================= */
app.get('/transferts/phone',requireLogin,(req,res)=>{
res.send(`
<html><body style="text-align:center;font-family:Arial">
<h2>Numéro de téléphone expéditeur</h2>
<form method="get" action="/transferts/new">
<input name="phone" placeholder="Téléphone" required>
<button>Continuer</button>
</form>
</body></html>
`);
});

/* ================= NOUVEAU TRANSFERT ================= */
app.get('/transferts/new',requireLogin, async(req,res)=>{
const code = await generateUniqueCode();
res.send(`
<html><head><style>
body{font-family:Arial;background:#f0f4f8}
.container{max-width:900px;margin:30px auto;background:#fff;padding:30px;border-radius:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
</style></head>
<body>
<div class="container">
<h2>➕ Nouveau Transfert</h2>
<form method="post">

<input name="senderPhone" value="${req.query.phone||''}" readonly>

<select name="currency">
${currencies.map(c=>`<option>${c}</option>`).join('')}
</select>

<div class="grid">
<input name="senderFirstName" placeholder="Prénom expéditeur" required>
<input name="senderLastName" placeholder="Nom expéditeur" required>
<select name="originLocation">${locations.map(l=>`<option>${l}</option>`)}</select>
</div>

<div class="grid">
<input name="receiverFirstName" placeholder="Prénom destinataire" required>
<input name="receiverLastName" placeholder="Nom destinataire" required>
<input name="receiverPhone" placeholder="Téléphone destinataire" required>
<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`)}</select>
</div>

<div class="grid">
<input type="number" name="amount" placeholder="Montant" required>
<input type="number" name="fees" placeholder="Frais" required>
<input name="code" value="${code}" readonly>
</div>

<button>Enregistrer</button>
</form>
</div>
</body></html>
`);
});

app.post('/transferts/new',requireLogin, async(req,res)=>{
  const amount=+req.body.amount, fees=+req.body.fees;
  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount:amount-fees
  }).save();
  res.redirect('/transferts/list');
});

/* ================= LISTE (DESIGN ORIGINAL CONSERVÉ) ================= */
app.get('/transferts/list',requireLogin, async(req,res)=>{
const list = await Transfert.find().sort({destinationLocation:1});
res.send(`
<html><body style="font-family:Arial">
<h2 style="text-align:center">📋 Liste des transferts</h2>
<table border="1" width="95%" align="center">
<tr style="background:#007bff;color:white">
<th>Code</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th>
</tr>
${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')"><button>❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}"><button>🖨️ Ticket</button></a>
</td>
</tr>`).join('')}
</table>
<br><center><a href="/transferts/pdf">📄 PDF</a></center>
</body></html>
`);
});

/* ================= MODIFIER ================= */
app.get('/transferts/edit/:id',requireLogin, async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`
<h2>Modifier</h2>
<form method="post">
<input name="amount" value="${t.amount}">
<input name="fees" value="${t.fees}">
<button>Enregistrer</button>
</form>
`);
});
app.post('/transferts/edit/:id',requireLogin, async(req,res)=>{
await Transfert.findByIdAndUpdate(req.params.id,{
  amount:+req.body.amount,
  fees:+req.body.fees,
  recoveryAmount:req.body.amount-req.body.fees
});
res.redirect('/transferts/list');
});

/* ================= SUPPRIMER ================= */
app.get('/transferts/delete/:id',requireLogin, async(req,res)=>{
await Transfert.findByIdAndDelete(req.params.id);
res.redirect('/transferts/list');
});

/* ================= TICKET ================= */
app.get('/transferts/print/:id',requireLogin, async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`
<html><body style="font-family:Arial;text-align:center">
<h3>💰 Ticket</h3>
<p>${t.amount} ${t.currency}</p>
<p>Code: ${t.code}</p>
<button onclick="window.print()">Imprimer</button>
</body></html>
`);
});

/* ================= PDF ================= */
app.get('/transferts/pdf',requireLogin, async(req,res)=>{
const list=await Transfert.find();
const doc=new PDFDocument();
res.setHeader('Content-Type','application/pdf');
doc.pipe(res);
doc.text('RAPPORT DES TRANSFERTS');
list.forEach(t=>doc.text(`${t.code} - ${t.amount} ${t.currency}`));
doc.end();
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= SERVEUR ================= */
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Serveur lancé'));
