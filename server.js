/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE AVEC CONTROLES FORMAT
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => {
    console.error('❌ Erreur MongoDB:', err.message);
    process.exit(1);
  });

// ================= CONSTANTES =================
const ALLOWED_CURRENCIES = ['GNF','XOF','EUR','USD'];
const ALLOWED_LOCATIONS = ['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'];
const ALLOWED_RETRAIT_MODES = ['ESPECE','TRANSFERT','VIREMENT','AUTRE'];

// ================= VALIDATIONS =================
function isValidPhone(phone){
  if(!phone) return false;
  return /^00224\d{9}$/.test(phone) || /^0033\d{9}$/.test(phone);
}
function isValidCurrency(c){ return ALLOWED_CURRENCIES.includes((c||'').toUpperCase()); }
function isValidLocation(l){ return ALLOWED_LOCATIONS.includes((l||'').toUpperCase()); }
function isValidRetraitMode(m){ return ALLOWED_RETRAIT_MODES.includes((m||'').toUpperCase()); }

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
  currency: { type:String, enum: ALLOWED_CURRENCIES },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type:Boolean, default:false },
  code: { type:String, unique:true },
  createdAt: { type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type:String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

const stockHistorySchema = new mongoose.Schema({
  code: String,
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: String,
  date: { type:Date, default:Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.floor(Math.random()*26)) +
           Math.floor(100+Math.random()*900);
    exists = await Transfert.findOne({code}) || await StockHistory.findOne({code});
  }
  return code;
}

const requireLogin=(req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<form method="post">
    <h2>Connexion</h2>
    <input name="username" required>
    <input type="password" name="password" required>
    <button>Connexion</button>
  </form>`);
});

app.post('/login', async(req,res)=>{
  const {username,password}=req.body;
  let user=await Auth.findOne({username});
  if(!user){
    user=await new Auth({username,password:bcrypt.hashSync(password,10)}).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user=user;
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await StockHistory.find().sort({date:-1});

  let html = `<h2>📊 Dashboard</h2>
  <a href="/logout">Déconnexion</a>
  <button onclick="newTransfert()">➕ Nouveau Transfert</button>

<script>
async function postData(url,data){
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
}

function newTransfert(){
  const originLocation = prompt('Origine (FRANCE, LABE, CONAKRY...)');
  const sender = prompt('Expéditeur');
  const senderPhone = prompt('Téléphone expéditeur');
  const destinationLocation = prompt('Destination');
  const receiver = prompt('Destinataire');
  const receiverPhone = prompt('Téléphone destinataire');
  const amount = parseFloat(prompt('Montant'));
  const fees = parseFloat(prompt('Frais'));
  const currency = prompt('Devise','GNF');

  postData('/transferts/form',{
    originLocation,
    senderFirstName:sender,
    senderPhone,
    destinationLocation,
    receiverFirstName:receiver,
    receiverPhone,
    amount,
    fees,
    currency,
    userType:'Client'
  }).then(()=>location.reload());
}
</script>`;

  html += `<table border="1"><tr><th>Code</th><th>Origine</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Status</th></tr>`;
  transferts.forEach(t=>{
    html += `<tr>
      <td>${t.code}</td>
      <td>${t.originLocation}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
    </tr>`;
  });
  html += `</table>`;

  res.send(html);
});

// ================= TRANSFERT =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const d=req.body;

    if(!isValidPhone(d.senderPhone)) return res.status(400).json({error:'Téléphone expéditeur invalide'});
    if(!isValidPhone(d.receiverPhone)) return res.status(400).json({error:'Téléphone destinataire invalide'});
    if(!isValidCurrency(d.currency)) return res.status(400).json({error:'Devise invalide'});
    if(!isValidLocation(d.originLocation)) return res.status(400).json({error:'Origine invalide'});
    if(!isValidLocation(d.destinationLocation)) return res.status(400).json({error:'Destination invalide'});

    d.originLocation=d.originLocation.toUpperCase();
    d.destinationLocation=d.destinationLocation.toUpperCase();
    d.currency=d.currency.toUpperCase();

    d.code = await generateUniqueCode();
    d.retraitHistory=[];
    await new Transfert(d).save();

    res.json({ok:true});
  }catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur transfert'});
  }
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const {id,mode}=req.body;
  if(!isValidRetraitMode(mode)) return res.status(400).json({error:'Mode invalide'});
  const t=await Transfert.findById(id);
  if(!t || t.retired) return res.status(400).json({error:'Impossible'});
  t.retired=true;
  t.retraitHistory.push({date:new Date(),mode:mode.toUpperCase()});
  await t.save();
  res.json({ok:true});
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
