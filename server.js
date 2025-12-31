/******************************************************************
 * APP TRANSFERT – VERSION FINALE UNIQUE & STABLE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ================= SESSION ================= */
app.use(session({
  name: 'transfert.sid',
  secret: 'transfert_secret_ultra_secure',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

/* ================= DATABASE ================= */
/* ✅ CONNEXION STANDARD PROPRE */
mongoose.connect('mongodb://127.0.0.1:27017/transfert', {
  autoIndex: true
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => {
  console.error('❌ Erreur MongoDB', err);
  process.exit(1);
});

/* ================= CONSTANTES ================= */
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const userSchema = new mongoose.Schema({
  username:{ type:String, unique:true },
  password:String
});
const User = mongoose.model('User', userSchema);

const stockSchema = new mongoose.Schema({
  location:String,
  currency:String,
  balance:{ type:Number, default:0 }
});
stockSchema.index({ location:1, currency:1 }, { unique:true });
const Stock = mongoose.model('Stock', stockSchema);

/* ================= UTILS ================= */
async function generateCode(){
  let code, exist=true;
  while(exist){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exist = await Transfert.findOne({code});
  }
  return code;
}
async function getStock(location,currency){
  let s = await Stock.findOne({location,currency});
  if(!s) s = await new Stock({location,currency}).save();
  return s;
}
function auth(req,res,next){
  if(req.session.user) return next();
  res.redirect('/login');
}

/* ================= AUTH ================= */
app.get('/login',(req,res)=>res.send(loginHTML()));
app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let u = await User.findOne({username});
  if(!u){
    u = await new User({
      username,
      password:bcrypt.hashSync(password,10)
    }).save();
  }
  if(!bcrypt.compareSync(password,u.password))
    return res.send('Mot de passe incorrect');
  req.session.user = username;
  res.redirect('/transferts');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= TRANSFERT FORM ================= */
app.get('/transfert',auth,async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t ? t.code : await generateCode();
  res.send(formHTML(t,code));
});
app.post('/transfert',auth,async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const exist = await Transfert.findOne({code:req.body.code});
  if(exist)
    await Transfert.updateOne({_id:exist._id},{...req.body,amount,fees,recoveryAmount});
  else
    await new Transfert({...req.body,amount,fees,recoveryAmount}).save();
  res.redirect('/transferts');
});

/* ================= LISTE ================= */
app.get('/transferts',auth,async(req,res)=>{
  const list = await Transfert.find().sort({createdAt:-1});
  res.send(listHTML(list));
});

/* ================= ACTIONS ================= */
app.post('/retirer',auth,async(req,res)=>{
  const t = await Transfert.findById(req.body.id);
  const s = await getStock(t.destinationLocation,t.currency);
  if(s.balance < t.recoveryAmount)
    return res.json({error:`Stock insuffisant (${s.balance})`});
  s.balance -= t.recoveryAmount;
  t.retired = true;
  await s.save(); await t.save();
  res.json({ok:true,rest:s.balance});
});
app.post('/delete',auth,async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({ok:true});
});

/* ================= STOCK ================= */
app.get('/stock',auth,async(req,res)=>{
  res.send(stockHTML(await Stock.find()));
});
app.post('/stock',auth,async(req,res)=>{
  const s = await getStock(req.body.location,req.body.currency);
  s.balance += Number(req.body.amount);
  await s.save();
  res.redirect('/stock');
});

/* ================= HTML ================= */
function loginHTML(){return`
<!DOCTYPE html><html><body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur">
<input type="password" name="password" placeholder="Mot de passe">
<button>Connexion</button>
</form></body></html>`}

function formHTML(t,code){return`
<h2>Transfert</h2>
<form method="post">
<input name="senderFirstName" placeholder="Expéditeur" value="${t?.senderFirstName||''}">
<input name="receiverFirstName" placeholder="Destinataire" value="${t?.receiverFirstName||''}">
<input name="amount" type="number" placeholder="Montant" value="${t?.amount||''}">
<input name="fees" type="number" placeholder="Frais" value="${t?.fees||''}">
<select name="currency">${currencies.map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`)}</select>
<select name="destinationLocation">${locations.map(l=>`<option ${t?.destinationLocation===l?'selected':''}>${l}</option>`)}</select>
<input name="code" readonly value="${code}">
<button>Enregistrer</button>
</form>
<a href="/transferts">Retour</a>`}

function listHTML(l){return`
<h2>Transferts</h2>
<a href="/transfert">➕ Nouveau</a> | <a href="/stock">🏦 Stock</a> | <a href="/logout">🚪</a>
<table border="1">
<tr><th>Code</th><th>Ville</th><th>Montant</th><th>Status</th><th>Actions</th></tr>
${l.map(x=>`
<tr data-id="${x._id}">
<td>${x.code}</td>
<td>${x.destinationLocation}</td>
<td>${x.recoveryAmount} ${x.currency}</td>
<td>${x.retired?'Retiré':'En attente'}</td>
<td>
${!x.retired?'<button onclick="ret(this)">💰</button>':''}
<button onclick="del(this)">❌</button>
</td></tr>`).join('')}
</table>
<script>
async function ret(b){
 const tr=b.closest('tr');
 const r=await fetch('/retirer',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({id:tr.dataset.id})});
 alert(JSON.stringify(await r.json()));
 location.reload();
}
async function del(b){
 const tr=b.closest('tr');
 await fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({id:tr.dataset.id})});
 tr.remove();
}
</script>`}

function stockHTML(s){return`
<h2>Stock</h2>
<form method="post">
<select name="location">${locations.map(l=>`<option>${l}</option>`)}</select>
<select name="currency">${currencies.map(c=>`<option>${c}</option>`)}</select>
<input name="amount" type="number">
<button>Ajouter</button>
</form>
<table border="1">
<tr><th>Ville</th><th>Devise</th><th>Solde</th></tr>
${s.map(x=>`<tr><td>${x.location}</td><td>${x.currency}</td><td>${x.balance}</td></tr>`).join('')}
</table>
<a href="/transferts">Retour</a>`}

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 Serveur lancé sur http://0.0.0.0:${PORT}`)
);
