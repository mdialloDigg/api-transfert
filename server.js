/******************************************************************
 * APP TRANSFERT – VERSION FINALE DASHBOARD MODERNE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true,
  store: new MongoStore({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert',
    collectionName: 'sessions'
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

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

// ================= UTILITAIRE =================
async function generateUniqueCode() {
  let code;
  let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
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

app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    const user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      await new Auth({ username, password: hashed }).save();
      req.session.user = username;
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = username;
    res.redirect('/menu');
  }catch(err){
    console.error('Erreur login:', err);
    res.status(500).send('Erreur serveur: ' + err.message);
  }
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px;}
button{width:280px;padding:15px;margin:12px;font-size:16px;border:none;border-radius:8px;color:white;cursor:pointer;transition:0.3s}
.send{background:#007bff}
.send:hover{background:#0056b3}
.list{background:#28a745}
.list:hover{background:#1e7e34}
.logout{background:#dc3545}
.logout:hover{background:#a71d2a}
</style></head>
<body>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>
`);
});

// ================= LOCATIONS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/new', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
.container{max-width:900px;margin:40px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{color:#2c7be5;text-align:center;margin-bottom:30px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:20px;}
label{display:block;margin-bottom:6px;font-weight:bold;color:#555;}
input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
input[readonly]{background:#e9ecef;}
button{width:100%;padding:15px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#218838;}
a{display:inline-block;margin-top:20px;color:#2c7be5;text-decoration:none;font-weight:bold;}
a:hover{text-decoration:underline;}
</style>
</head>
<body>
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

<h3>Montants & Code</h3>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" required></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly></div>
<div><label>Devise</label><select name="currency">
${currencies.map(c=>`<option>${c}</option>`).join('')}
</select></div>
<div><label>Code transfert</label><input type="text" id="code" name="code" readonly value="${code}"></div>
</div>

<button>Enregistrer</button>
</form>

<center><a href="/menu">⬅ Retour menu</a></center>
</div>

<script>
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');

function updateRecovery() {
  const amount = parseFloat(amountField.value) || 0;
  const fees = parseFloat(feesField.value) || 0;
  recoveryField.value = amount - fees;
}
amountField.addEventListener('input', updateRecovery);
feesField.addEventListener('input', updateRecovery);
updateRecovery();
</script>
</body>
</html>
`);
});

// ================= ENREGISTRER / MODIFIER =================
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

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
