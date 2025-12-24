/******************************************************************
 * APP TRANSFERT – VERSION TOTALE COMPLÈTE + DESIGN (RENDER READY)
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

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
.catch(err=>console.error('❌ MongoDB error:', err));

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
    code = String.fromCharCode(65+Math.random()*26|0)+(1000+Math.random()*9000|0);
    ok = !(await Transfert.findOne({ code }));
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const countries = ['Guinée','France','Belgique','Sénégal','Côte d’Ivoire','USA','Canada'];

/* ================= CSS ================= */
const css = `
body{font-family:Arial;background:#f2f2f2}
.container{max-width:800px;margin:40px auto;background:#fff;padding:30px;
border-radius:10px;box-shadow:0 0 10px rgba(0,0,0,.1);text-align:center}
input,select{width:90%;padding:10px;margin:5px;border-radius:5px;border:1px solid #ccc}
button{padding:10px 20px;margin:10px;background:#007bff;color:#fff;border:none;border-radius:5px;cursor:pointer}
button:hover{background:#0056b3}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{border:1px solid #ccc;padding:8px}
a{text-decoration:none;color:#007bff}
h2,h3{margin-top:20px}
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
    return res.send('❌ Identifiants invalides');
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
<a href="/logout"><button>Déconnexion</button></a>
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

<button>Enregistrer</button>
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
res.send(`
<style>${css}</style>
<div class="container">
<h2>Liste des transferts</h2>
<table>
<tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Reçu</th><th>Mode</th><th>Actions</th></tr>
${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.recoveryAmount}</td>
<td>${t.recoveryMode}</td>
<td>
<a href="/transferts/print/${t._id}">🖨</a>
<form method="post" action="/transferts/delete" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<button>❌</button>
</form>
</td>
</tr>`).join('')}
</table>
<a href="/menu">⬅ Menu</a>
</div>
`);
});

/* ================= PRINT ================= */
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
res.send(`
<script>window.print()</script>
<h1>CODE : ${t.code}</h1>
<p>Montant reçu : ${t.recoveryAmount}</p>
<p>Mode : ${t.recoveryMode}</p>
`);
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
