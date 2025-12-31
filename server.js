/******************************************************************
 * APP TRANSFERT – VERSION FINALE AVEC GESTION DE STOCK PAR VILLE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret:'transfert-secret-final',
  resave:false,
  saveUninitialized:true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= CONSTANTES =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= SCHEMAS =================
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
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  recoveryMode:String,
  retired:{ type:Boolean, default:false },
  retraitHistory:[{ date:Date, mode:String }],
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{ type:String, default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

// ======== STOCK SCHEMA ========
const stockSchema = new mongoose.Schema({
  location:String,
  currency:String,
  balance:{ type:Number, default:0 },
  updatedAt:{ type:Date, default:Date.now }
});
stockSchema.index({ location:1, currency:1 }, { unique:true });
const Stock = mongoose.model('Stock', stockSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists = await Transfert.findOne({code});
  }
  return code;
}

async function getStock(location,currency){
  let s = await Stock.findOne({location,currency});
  if(!s) s = await new Stock({location,currency,balance:0}).save();
  return s;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`<form method="post" style="max-width:300px;margin:100px auto">
<h2>Connexion</h2>
<input name="username" placeholder="Utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Se connecter</button>
</form>`);
});

app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let u=await Auth.findOne({username});
  if(!u) u=await new Auth({username,password:bcrypt.hashSync(password,10)}).save();
  if(!bcrypt.compareSync(password,u.password)) return res.send('Mot de passe incorrect');
  req.session.user={username,permissions:setPermissions(username)};
  res.redirect('/transferts/list');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

// ================= STOCK DEPOT =================
app.get('/stock/depot',requireLogin,async(req,res)=>{
  const stocks=await Stock.find().sort({location:1});
res.send(`
<h2>Dépôt de stock</h2>
<form method="post">
<select name="location">${locations.map(l=>`<option>${l}</option>`)}</select>
<select name="currency">${currencies.map(c=>`<option>${c}</option>`)}</select>
<input type="number" name="amount" placeholder="Montant" required>
<button>Ajouter</button>
</form>
<h3>Stock actuel</h3>
<table border="1">
<tr><th>Ville</th><th>Devise</th><th>Solde</th></tr>
${stocks.map(s=>`<tr><td>${s.location}</td><td>${s.currency}</td><td>${s.balance}</td></tr>`).join('')}
</table>
<a href="/transferts/list">Retour</a>
`);
});
app.post('/stock/depot',requireLogin,async(req,res)=>{
  const {location,currency,amount}=req.body;
  const s=await getStock(location,currency);
  s.balance+=Number(amount);
  s.updatedAt=new Date();
  await s.save();
  res.redirect('/stock/depot');
});

// ================= TRANSFERT FORM =================
app.get('/transferts/form',requireLogin,async(req,res)=>{
  const t=req.query.code?await Transfert.findOne({code:req.query.code}):null;
  const code=t?t.code:await generateUniqueCode();
res.send(`
<form method="post">
<input name="senderFirstName" placeholder="Prénom expéditeur" value="${t?.senderFirstName||''}">
<input name="senderLastName" placeholder="Nom expéditeur" value="${t?.senderLastName||''}">
<input name="senderPhone" placeholder="Téléphone expéditeur" value="${t?.senderPhone||''}">
<select name="originLocation">${locations.map(l=>`<option ${t?.originLocation===l?'selected':''}>${l}</option>`)}</select>

<input name="receiverFirstName" placeholder="Prénom destinataire" value="${t?.receiverFirstName||''}">
<input name="receiverLastName" placeholder="Nom destinataire" value="${t?.receiverLastName||''}">
<input name="receiverPhone" placeholder="Téléphone destinataire" value="${t?.receiverPhone||''}">
<select name="destinationLocation">${locations.map(l=>`<option ${t?.destinationLocation===l?'selected':''}>${l}</option>`)}</select>

<input type="number" name="amount" placeholder="Montant" value="${t?.amount||''}">
<input type="number" name="fees" placeholder="Frais" value="${t?.fees||''}">
<select name="currency">${currencies.map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`)}</select>
<input name="code" readonly value="${code}">
<button>Enregistrer</button>
</form>
<a href="/transferts/list">Retour</a>
`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
  const amount=Number(req.body.amount),fees=Number(req.body.fees);
  const recoveryAmount=amount-fees;
  const exist=await Transfert.findOne({code:req.body.code});
  if(exist) await Transfert.findByIdAndUpdate(exist._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount}).save();
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const t=await Transfert.find().sort({createdAt:-1});
res.send(`
<h2>Transferts</h2>
<a href="/transferts/form">Nouveau</a> |
<a href="/stock/depot">Gestion Stock</a> |
<a href="/logout">Déconnexion</a>
<table border="1">
<tr><th>Code</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Action</th></tr>
${t.map(x=>`
<tr>
<td>${x.code}</td>
<td>${x.destinationLocation}</td>
<td>${x.recoveryAmount}</td>
<td>${x.currency}</td>
<td>${x.retired?'Retiré':'Non retiré'}</td>
<td>${!x.retired?`<button onclick="retirer('${x._id}')">Retirer</button>`:''}</td>
</tr>`).join('')}
</table>
<script>
async function retirer(id){
 const r=await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:'Espèces'})});
 const d=await r.json();
 if(d.error) alert(d.error);
 else alert('Retrait OK. Stock restant: '+d.remainingStock+' '+d.currency);
 location.reload();
}
</script>
`);
});

// ================= RETRAIT =================
app.post('/transferts/retirer',requireLogin,async(req,res)=>{
  const t=await Transfert.findById(req.body.id);
  const s=await getStock(t.destinationLocation,t.currency);
  if(s.balance<t.recoveryAmount) return res.send({error:'Stock insuffisant'});
  s.balance-=t.recoveryAmount; await s.save();
  t.retired=true; await t.save();
  res.send({ok:true,remainingStock:s.balance,currency:s.currency});
});

// ================= SERVER =================
app.listen(3000,()=>console.log('🚀 http://localhost:3000'));
