/******************************************************************
 * APP TRANSFERT – VERSION FINALE ULTIME
 * - Comptes utilisateurs
 * - Transferts
 * - Modifier / Supprimer
 * - Mode de retrait
 * - Impression code transfert
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
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect('mongodb://127.0.0.1:27017/transfert_final')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
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
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0) + (100+Math.random()*900|0);
    exists = await Transfert.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const locations = ['France','Belgique','Conakry','Suisse','USA','Canada'];

// ================= LOGIN / REGISTER =================
app.get('/login',(req,res)=>res.send(`
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
<a href="/register">Créer un compte</a>
`));

app.post('/login',async(req,res)=>{
  const u = await Auth.findOne({username:req.body.username});
  if(!u || !bcrypt.compareSync(req.body.password,u.password))
    return res.send('Login incorrect');
  req.session.user = u.username;
  res.redirect('/menu');
});

app.get('/register',(req,res)=>res.send(`
<h2>Créer un compte</h2>
<form method="post">
<input name="username" required><br>
<input type="password" name="password" required><br>
<button>Créer</button>
</form>
`));

app.post('/register',async(req,res)=>{
  const hash = bcrypt.hashSync(req.body.password,10);
  await new Auth({username:req.body.username,password:hash}).save();
  res.redirect('/login');
});

// ================= MENU =================
app.get('/menu',requireLogin,(req,res)=>res.send(`
<h2>Menu</h2>
<a href="/transferts/new">➕ Nouveau transfert</a><br>
<a href="/transferts/list">📋 Liste des transferts</a><br>
<a href="/logout">🚪 Déconnexion</a>
`));

// ================= NOUVEAU TRANSFERT =================
app.get('/transferts/new',requireLogin,async(req,res)=>{
  const code = await generateUniqueCode();
res.send(`
<h2>Nouveau transfert</h2>
<form method="post">
Montant <input type="number" id="amount" name="amount" required><br>
Frais <input type="number" id="fees" name="fees" required><br>
Montant reçu <input id="recoveryAmount" readonly><br>
Code <input name="code" value="${code}" readonly><br>

Mode de retrait
<select name="recoveryMode">
<option>Espèces</option>
<option>Orange Money</option>
<option>MTN Money</option>
<option>Wave</option>
<option>Autre</option>
</select><br>

<button>Enregistrer</button>
</form>

<script>
const a=document.getElementById('amount'),
f=document.getElementById('fees'),
r=document.getElementById('recoveryAmount');
function calc(){r.value=(a.value||0)-(f.value||0);}
a.oninput=f.oninput=calc;
</script>
`);
});

// ================= SAVE =================
app.post('/transferts/new',requireLogin,async(req,res)=>{
  const amount=+req.body.amount, fees=+req.body.fees;
  await new Transfert({
    ...req.body,
    amount, fees,
    recoveryAmount: amount-fees
  }).save();
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const list = await Transfert.find();
  let html=`<h2>Liste</h2><table border="1"><tr>
  <th>Code</th><th>Montant</th><th>Reçu</th><th>Mode</th><th>Actions</th></tr>`;
  list.forEach(t=>{
    html+=`<tr>
<td>${t.code}</td>
<td>${t.amount}</td>
<td>${t.recoveryAmount}</td>
<td>${t.recoveryMode}</td>
<td>
<a href="/transferts/print/${t._id}">🖨️ Imprimer</a>
<form method="post" action="/transferts/delete" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<button>❌ Supprimer</button>
</form>
</td>
</tr>`;
  });
  res.send(html+'</table>');
});

// ================= IMPRIMER CODE =================
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
res.send(`
<script>window.print()</script>
<h2>CODE DE TRANSFERT</h2>
<h1>${t.code}</h1>
<p>Montant: ${t.amount}</p>
<p>Reçu: ${t.recoveryAmount}</p>
<p>Mode: ${t.recoveryMode}</p>
<p>Expéditeur: ${t.senderFirstName||''} ${t.senderLastName||''}</p>
<p>Destinataire: ${t.receiverFirstName||''} ${t.receiverLastName||''}</p>
`);
});

// ================= DELETE =================
app.post('/transferts/delete',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.redirect('/transferts/list');
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// ================= SERVER =================
app.listen(3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
