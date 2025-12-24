/******************************************************************
 * APP TRANSFERT – VERSION COMPLÈTE FINALE (RENDER READY)
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
  cookie: {
    secure: true,
    sameSite: 'none'
  }
}));

/* ================= DATABASE ================= */
console.log('MONGODB_URI =', process.env.MONGODB_URI ? 'OK' : 'MANQUANT');

mongoose.connect(process.env.MONGODB_URI)
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>console.error('❌ MongoDB error:', err));

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
  username: { type: String, unique: true },
  password: String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    code = String.fromCharCode(65 + Math.random()*26|0) +
           (100 + Math.random()*900|0);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const locations = ['France','Belgique','Conakry','Suisse','USA','Canada'];

/* ================= AUTH ================= */
app.get('/login',(req,res)=>res.send(`
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
<a href="/register">Créer un compte</a>
`));

app.post('/login', async(req,res)=>{
  try{
    const user = await Auth.findOne({ username:req.body.username });
    if(!user) return res.send('❌ Compte inexistant');
    if(!bcrypt.compareSync(req.body.password,user.password))
      return res.send('❌ Mot de passe incorrect');

    req.session.user = user.username;
    res.redirect('/menu');
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur login');
  }
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
  await new Auth({ username:req.body.username, password:hash }).save();
  res.redirect('/login');
});

/* ================= MENU ================= */
app.get('/menu',requireLogin,(req,res)=>res.send(`
<h2>📲 Menu</h2>
<a href="/transferts/new">➕ Nouveau transfert</a><br>
<a href="/transferts/list">📋 Liste des transferts</a><br>
<a href="/logout">🚪 Déconnexion</a>
`));

/* ================= NOUVEAU TRANSFERT ================= */
app.get('/transferts/new',requireLogin,async(req,res)=>{
  const code = await generateUniqueCode();
res.send(`
<h2>Nouveau transfert</h2>
<form method="post">

<h3>Type</h3>
<select name="userType">
<option>Client</option>
<option>Distributeur</option>
<option>Administrateur</option>
<option>Agence</option>
</select>

<h3>Expéditeur</h3>
<input name="senderFirstName" placeholder="Prénom" required>
<input name="senderLastName" placeholder="Nom" required>
<input name="senderPhone" placeholder="Téléphone" required>
<select name="originLocation">
${locations.map(l=>`<option>${l}</option>`).join('')}
</select>

<h3>Destinataire</h3>
<input name="receiverFirstName" placeholder="Prénom" required>
<input name="receiverLastName" placeholder="Nom" required>
<input name="receiverPhone" placeholder="Téléphone" required>
<select name="destinationLocation">
${locations.map(l=>`<option>${l}</option>`).join('')}
</select>

<h3>Montants</h3>
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
const a=document.getElementById('amount');
const f=document.getElementById('fees');
const r=document.getElementById('recoveryAmount');
function calc(){ r.value=(a.value||0)-(f.value||0); }
a.oninput=f.oninput=calc;
</script>
`);
});

app.post('/transferts/new',requireLogin,async(req,res)=>{
  const amount=+req.body.amount, fees=+req.body.fees;
  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount: amount-fees
  }).save();
  res.redirect('/transferts/list');
});

/* ================= LISTE ================= */
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const list = await Transfert.find().sort({createdAt:-1});
  let html=`<h2>Liste des transferts</h2><table border="1">
<tr>
<th>Code</th><th>Expéditeur</th><th>Destinataire</th>
<th>Montant</th><th>Reçu</th><th>Mode</th><th>Actions</th>
</tr>`;
  list.forEach(t=>{
    html+=`
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
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
  res.send(html+'</table><a href="/menu">⬅ Menu</a>');
});

/* ================= PRINT ================= */
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
res.send(`
<script>window.print()</script>
<h2>CODE DE TRANSFERT</h2>
<h1>${t.code}</h1>
<p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
<p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
<p>Montant: ${t.amount}</p>
<p>Reçu: ${t.recoveryAmount}</p>
<p>Mode: ${t.recoveryMode}</p>
`);
});

/* ================= DELETE ================= */
app.post('/transferts/delete',requireLogin,async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.redirect('/transferts/list');
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur prêt sur ${PORT}`));
