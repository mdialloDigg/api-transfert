const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ===================== SAFE MONGO ===================== */

let mongoConnected = false;
const MONGO_URI = process.env.MONGO_URI;

if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => {
      mongoConnected = true;
      console.log('✅ MongoDB connecté');
    })
    .catch(err => {
      console.error('❌ MongoDB erreur:', err.message);
    });
} else {
  console.warn('⚠️ MONGO_URI absent — mode maintenance');
}

/* ===================== SCHEMAS ===================== */

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
  retired:{type:Boolean,default:false},
  code:String,
  createdAt:{type:Date,default:Date.now}
});

const authSchema = new mongoose.Schema({
  username:String,
  password:String
});

const Transfert = mongoose.model('Transfert', transfertSchema);
const Auth = mongoose.model('Auth', authSchema);

/* ===================== MIDDLEWARE ===================== */

const requireLogin = (req,res,next)=>{
  if(!mongoConnected){
    return res.send('<h2>⚠️ Maintenance : base de données indisponible</h2>');
  }
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ===================== LOGIN ===================== */

app.get('/login',(req,res)=>{
res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;height:100vh;display:flex;justify-content:center;align-items:center;background:linear-gradient(135deg,#ff8c42,#ffa64d);font-family:Arial}
.box{background:#fff;padding:40px;border-radius:20px;width:90%;max-width:350px}
h2{text-align:center;color:#ff8c42}
input,button{width:100%;padding:15px;margin-top:12px;border-radius:10px;font-size:16px}
button{background:#ff8c42;color:#fff;border:none;font-weight:bold}
</style>
</head>
<body>
<div class="box">
<h2>Connexion</h2>
${!mongoConnected?'<p style="color:red">Base indisponible</p>':''}
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Connexion</button>
</form>
</div>
</body>
</html>
`);
});

app.post('/login',async(req,res)=>{
  if(!mongoConnected) return res.send('Base indisponible');
  let user = await Auth.findOne({username:req.body.username});
  if(!user){
    user = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,user.password)){
    return res.send('Mot de passe incorrect');
  }
  req.session.user = {username:user.username};
  res.redirect('/transferts');
});

/* ===================== TRANSFERT ===================== */

app.get('/transferts',requireLogin,async(req,res)=>{
const list = await Transfert.find().sort({createdAt:-1});
res.send(`
<h2>Transferts</h2>
<a href="/form">➕ Nouveau</a> | <a href="/logout">Déconnexion</a>
<table border="1" cellpadding="5">
<tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th></tr>
${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName}</td>
<td>${t.receiverFirstName}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'En attente'}</td>
<td>
<a href="/form?code=${t.code}">✏️</a>
<button onclick="fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${t._id}'})}).then(()=>location.reload())">❌</button>
${!t.retired?`<button onclick="fetch('/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${t._id}'})}).then(()=>location.reload())">💰</button>`:''}
</td>
</tr>
`).join('')}
</table>
`);
});

app.get('/form',requireLogin,async(req,res)=>{
const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
res.send(`
<h2>${t?'Modifier':'Nouveau'} Transfert</h2>
<form method="post">
<input name="code" value="${t?.code||Math.random().toString(36).substring(2,6).toUpperCase()}" required>
<input name="senderFirstName" placeholder="Prénom expéditeur" value="${t?.senderFirstName||''}" required>
<input name="receiverFirstName" placeholder="Prénom destinataire" value="${t?.receiverFirstName||''}" required>
<input type="number" name="amount" placeholder="Montant" value="${t?.amount||0}">
<input type="number" name="fees" placeholder="Frais" value="${t?.fees||0}">
<select name="currency"><option>EUR</option><option>USD</option><option>GNF</option></select>
<button>Enregistrer</button>
</form>
<a href="/transferts">⬅ Retour</a>
`);
});

app.post('/form',requireLogin,async(req,res)=>{
const amount=+req.body.amount, fees=+req.body.fees;
const recoveryAmount = amount-fees;
const data = {...req.body,amount,fees,recoveryAmount};
const exist = await Transfert.findOne({code:req.body.code});
if(exist) await Transfert.updateOne({_id:exist._id},data);
else await new Transfert(data).save();
res.redirect('/transferts');
});

app.post('/retirer',requireLogin,async(req,res)=>{
await Transfert.updateOne({_id:req.body.id},{retired:true});
res.send({ok:true});
});

app.post('/delete',requireLogin,async(req,res)=>{
await Transfert.deleteOne({_id:req.body.id});
res.send({ok:true});
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ===================== SERVER ===================== */

const PORT = process.env.PORT || 10000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Serveur lancé sur',PORT));
