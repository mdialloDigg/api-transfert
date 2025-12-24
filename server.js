/******************************************************************
 * APP TRANSFERT – VERSION ULTIME COMPLÈTE (RENDER READY)
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const app = express();

/* ================= CONFIG ================= */
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  name: 'transfert.sid',
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'none' }
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>console.error('❌ MongoDB:', err));

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: String,

  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originCountry: String,

  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationCountry: String,

  amount: Number,
  fees: Number,
  recoveryAmount: Number,

  code: { type: String, unique: true },

  recoveryMode: String,
  retired: { type: Boolean, default: false },
  retraitDate: Date,

  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateCode(){
  let code, ok=false;
  while(!ok){
    code = String.fromCharCode(65+Math.random()*26|0) + (100000+Math.random()*900000|0);
    ok = !(await Transfert.findOne({ code }));
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const countries = ['Guinée','France','Belgique','Sénégal','USA','Canada'];

/* ================= CSS ================= */
const css = `
body{font-family:Arial;background:#eef2f7}
.container{max-width:900px;margin:40px auto;background:#fff;padding:30px;
border-radius:12px;box-shadow:0 5px 15px rgba(0,0,0,.1);text-align:center}
input,select{width:90%;padding:10px;margin:6px;border-radius:6px;border:1px solid #ccc}
button{padding:10px 25px;margin:10px;border:none;border-radius:6px;
background:#007bff;color:#fff;cursor:pointer}
button.danger{background:#dc3545}
button.success{background:#28a745}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{border:1px solid #ccc;padding:8px}
th{background:#007bff;color:#fff}
a{text-decoration:none}
h2,h3{margin:15px 0}
`;

/* ================= AUTH ================= */
app.get('/login',(req,res)=>res.send(`
<style>${css}</style>
<div class="container">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Connexion</button>
</form>
<a href="/register">Créer un compte</a>
</div>
`));

app.post('/login',async(req,res)=>{
  const u = await Auth.findOne({ username:req.body.username });
  if(!u || !bcrypt.compareSync(req.body.password,u.password))
    return res.send('❌ Identifiants incorrects');
  req.session.user=u.username;
  res.redirect('/menu');
});

app.get('/register',(req,res)=>res.send(`
<style>${css}</style>
<div class="container">
<h2>Créer un compte</h2>
<form method="post">
<input name="username" required>
<input type="password" name="password" required>
<button>Créer</button>
</form>
</div>
`));

app.post('/register',async(req,res)=>{
  await new Auth({
    username:req.body.username,
    password:bcrypt.hashSync(req.body.password,10)
  }).save();
  res.redirect('/login');
});

/* ================= MENU ================= */
app.get('/menu',requireLogin,(req,res)=>res.send(`
<style>${css}</style>
<div class="container">
<h2>Menu principal</h2>
<a href="/transferts/new"><button>Nouveau transfert</button></a>
<a href="/transferts/list"><button>Liste des transferts</button></a>
<a href="/logout"><button class="danger">Déconnexion</button></a>
</div>
`));

/* ================= NOUVEAU TRANSFERT ================= */
app.get('/transferts/new',requireLogin,async(req,res)=>{
  const code = await generateCode();
res.send(`
<style>${css}</style>
<div class="container">
<h2>Nouveau transfert</h2>
<form method="post">

<h3>Expéditeur</h3>
<input name="senderFirstName" placeholder="Prénom" required>
<input name="senderLastName" placeholder="Nom" required>
<input name="senderPhone" placeholder="Téléphone" required>
<select name="originCountry">${countries.map(c=>`<option>${c}</option>`).join('')}</select>

<h3>Destinataire</h3>
<input name="receiverFirstName" placeholder="Prénom" required>
<input name="receiverLastName" placeholder="Nom" required>
<input name="receiverPhone" placeholder="Téléphone" required>
<select name="destinationCountry">${countries.map(c=>`<option>${c}</option>`).join('')}</select>

<h3>Montants</h3>
<input id="amount" name="amount" type="number" placeholder="Montant" required>
<input id="fees" name="fees" type="number" placeholder="Frais" required>
<input id="recoveryAmount" placeholder="Montant reçu" readonly>
<input name="code" value="${code}" readonly>

<select name="recoveryMode">
<option>Espèces</option>
<option>Orange Money</option>
<option>MTN Money</option>
<option>Wave</option>
<option>Autre</option>
</select>

<button class="success">Enregistrer</button>
</form>
</div>

<script>
const a=document.getElementById('amount');
const f=document.getElementById('fees');
const r=document.getElementById('recoveryAmount');
function calc(){r.value=(a.value||0)-(f.value||0);}
a.oninput=f.oninput=calc;
</script>
`);
});

app.post('/transferts/new',requireLogin,async(req,res)=>{
  const a=+req.body.amount,f=+req.body.fees;
  await new Transfert({...req.body,amount:a,fees:f,recoveryAmount:a-f}).save();
  res.redirect('/transferts/list');
});

/* ================= LISTE ================= */
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const list = await Transfert.find().sort({createdAt:-1});

let rows = '';
for(const t of list){
  const qr = await QRCode.toDataURL(t.code);
  rows += `
<tr>
<td>${t.code}<br><img src="${qr}" width="80"></td>
<td>${t.senderFirstName} → ${t.receiverFirstName}</td>
<td>${t.recoveryAmount}</td>
<td>${t.recoveryMode}</td>
<td>${t.retired?'✅ Retiré':'⏳ En attente'}</td>
<td>
<a href="/transferts/edit/${t._id}">✏️</a>
<a href="/transferts/retirer/${t._id}">💳</a>
<a href="/transferts/pdf/${t._id}">🧾</a>
<form method="post" action="/transferts/delete" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<button class="danger">❌</button>
</form>
</td>
</tr>`;
}

res.send(`
<style>${css}</style>
<div class="container">
<h2>Liste des transferts</h2>
<table>
<tr><th>Code</th><th>Clients</th><th>Reçu</th><th>Mode</th><th>Statut</th><th>Actions</th></tr>
${rows}
</table>
<a href="/menu">⬅ Menu</a>
</div>
`);
});

/* ================= RETRAIT ================= */
app.get('/transferts/retirer/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(t.retired) return res.send('Déjà retiré');

res.send(`
<style>${css}</style>
<div class="container">
<h2>Retrait - Code ${t.code}</h2>
<form method="post">
<select name="recoveryMode">
<option>Espèces</option>
<option>Orange Money</option>
<option>MTN Money</option>
<option>Wave</option>
<option>Autre</option>
</select>
<button class="success">Valider retrait</button>
</form>
</div>
`);
});

app.post('/transferts/retirer/:id',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.params.id,{
    retired:true,
    retraitDate:new Date(),
    recoveryMode:req.body.recoveryMode
  });
  res.redirect('/transferts/list');
});

/* ================= MODIFIER ================= */
app.get('/transferts/edit/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
res.send(`
<style>${css}</style>
<div class="container">
<h2>Modifier transfert</h2>
<form method="post">
<input name="amount" value="${t.amount}">
<input name="fees" value="${t.fees}">
<button class="success">Modifier</button>
</form>
</div>
`);
});

app.post('/transferts/edit/:id',requireLogin,async(req,res)=>{
  const a=+req.body.amount,f=+req.body.fees;
  await Transfert.findByIdAndUpdate(req.params.id,{
    amount:a,fees:f,recoveryAmount:a-f
  });
  res.redirect('/transferts/list');
});

/* ================= PDF ================= */
app.get('/transferts/pdf/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  const qr = await QRCode.toDataURL(t.code);

  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline');
  doc.pipe(res);

  doc.fontSize(18).text('REÇU DE TRANSFERT',{align:'center'});
  doc.moveDown();
  doc.text(`Code : ${t.code}`);
  doc.text(`Montant reçu : ${t.recoveryAmount}`);
  doc.text(`Mode : ${t.recoveryMode}`);
  doc.image(qr, { width:120 });
  doc.end();
});

/* ================= DELETE ================= */
app.post('/transferts/delete',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.redirect('/transferts/list');
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur prêt'));
