/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE AVEC VALIDATIONS
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

// ================= CONSTANTES DE VALIDATION =================
const ALLOWED_CURRENCIES = ['GNF','XOF','EUR','USD'];
const ALLOWED_LOCATIONS = ['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'];
const ALLOWED_RETRAIT_MODES = ['ESPECE','TRANSFERT','VIREMENT','AUTRE'];

// ================= FONCTIONS DE VALIDATION =================
function isValidPhone(phone){
  if(!phone) return false;
  return /^00224\d{9}$/.test(phone) || /^0033\d{9}$/.test(phone);
}

function isValidCurrency(currency){
  return ALLOWED_CURRENCIES.includes((currency||'').toUpperCase());
}

function isValidLocation(location){
  return ALLOWED_LOCATIONS.includes((location||'').toUpperCase());
}

function isValidRetraitMode(mode){
  return ALLOWED_RETRAIT_MODES.includes((mode||'').toUpperCase());
}

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type: String, required:true },
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
  currency: { type: String, enum: ALLOWED_CURRENCIES },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum:['admin','agent'], default:'agent' }
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
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65 + Math.floor(Math.random()*26)) +
           Math.floor(100 + Math.random()*900);
    exists = await Transfert.findOne({code}) || await StockHistory.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`
  <form method="post">
    <h2>Connexion</h2>
    <input name="username" required placeholder="Utilisateur">
    <input type="password" name="password" required placeholder="Mot de passe">
    <button>Connexion</button>
  </form>
  `);
});

app.post('/login', async(req,res)=>{
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){
    user = await new Auth({
      username,
      password: bcrypt.hashSync(password,10)
    }).save();
  }
  if(!bcrypt.compareSync(password,user.password)){
    return res.send('Mot de passe incorrect');
  }
  req.session.user = user;
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// ================= TRANSFERT =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const d = req.body;

    // ===== VALIDATIONS =====
    if(!isValidPhone(d.senderPhone)) return res.status(400).json({error:'Téléphone expéditeur invalide'});
    if(!isValidPhone(d.receiverPhone)) return res.status(400).json({error:'Téléphone destinataire invalide'});
    if(!isValidCurrency(d.currency)) return res.status(400).json({error:'Devise invalide'});
    if(!isValidLocation(d.originLocation)) return res.status(400).json({error:'Origine invalide'});
    if(!isValidLocation(d.destinationLocation)) return res.status(400).json({error:'Destination invalide'});
    if(isNaN(d.amount) || d.amount <= 0) return res.status(400).json({error:'Montant invalide'});
    if(isNaN(d.fees) || d.fees < 0) return res.status(400).json({error:'Frais invalides'});

    d.originLocation = d.originLocation.toUpperCase();
    d.destinationLocation = d.destinationLocation.toUpperCase();
    d.currency = d.currency.toUpperCase();

    if(d._id){
      await Transfert.findByIdAndUpdate(d._id, d);
    } else {
      d.code = await generateUniqueCode();
      d.retraitHistory = [];
      await new Transfert(d).save();
    }

    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur transfert'});
  }
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id, mode} = req.body;

    if(!isValidRetraitMode(mode)){
      return res.status(400).json({error:'Mode de retrait non autorisé'});
    }

    const t = await Transfert.findById(id);
    if(!t) return res.status(404).json({error:'Introuvable'});
    if(t.retired) return res.status(400).json({error:'Déjà retiré'});

    t.retired = true;
    t.retraitHistory.push({date:new Date(), mode: mode.toUpperCase()});
    await t.save();

    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur retrait'});
  }
});

// ================= STOCK =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{
    const d = req.body;

    if(!isValidPhone(d.senderPhone)) return res.status(400).json({error:'Téléphone expéditeur invalide'});
    if(!isValidPhone(d.destinationPhone)) return res.status(400).json({error:'Téléphone destination invalide'});
    if(!isValidCurrency(d.currency)) return res.status(400).json({error:'Devise invalide'});
    if(!isValidLocation(d.destination)) return res.status(400).json({error:'Destination invalide'});
    if(isNaN(d.amount) || d.amount <= 0) return res.status(400).json({error:'Montant invalide'});

    d.currency = d.currency.toUpperCase();
    d.destination = d.destination.toUpperCase();

    if(d._id){
      await StockHistory.findByIdAndUpdate(d._id,d);
    } else {
      d.code = await generateUniqueCode();
      await new StockHistory(d).save();
    }

    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur stock'});
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
