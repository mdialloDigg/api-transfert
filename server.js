/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,
  amount:Number,
  fees:Number,
  feePercent:Number,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,
  recoveryAmount:Number,
  recoveryMode:String,
  code:String,
  status:{type:String,default:'actif'},
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},
  createdAt:{type:Date,default:Date.now}
});
const User = mongoose.model('User',userSchema);

const authUserSchema = new mongoose.Schema({
  username:{type:String,unique:true},
  password:String,
  createdAt:{type:Date,default:Date.now}
});
const AuthUser = mongoose.model('AuthUser',authUserSchema);

/* ================= AUTH MIDDLEWARE ================= */
function requireLogin(req,res,next){
  if(req.session.userId) return next();
  res.redirect('/login');
}

/* ================= AUTH ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>🔑 Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<a href="/register">Créer un compte</a>
</body></html>
`);
});

app.post('/login',async(req,res)=>{
const u=await AuthUser.findOne({username:req.body.username});
if(!u) return res.send("Utilisateur inconnu");
const ok=await bcrypt.compare(req.body.password,u.password);
if(!ok) return res.send("Mot de passe incorrect");
req.session.userId=u._id;
res.redirect('/users/choice');
});

app.get('/register',(req,res)=>{
res.send(`
<html><body style="font-family:Arial;text-align:center;padding-top:60px">
<h2>📝 Inscription</h2>
<form method="post">
<input name="username" required><br><br>
<input type="password" name="password" required><br><br>
<button>Créer</button>
</form>
</body></html>
`);
});

app.post('/register',async(req,res)=>{
const hash=await bcrypt.hash(req.body.password,10);
await new AuthUser({username:req.body.username,password:hash}).save();
res.redirect('/login');
});

app.get('/logout',(req,res)=>{
req.session.destroy(()=>res.redirect('/login'));
});

/* ================= ACCÈS FORM ================= */
app.get('/users',requireLogin,(req,res)=>{
if(!req.session.formAccess){
return res.send(`
<form method="post" action="/auth/form" style="text-align:center;margin-top:80px">
<input type="password" name="code" placeholder="Code 123">
<button>OK</button>
</form>
`);
}
res.redirect('/users/choice');
});

app.post('/auth/form',(req,res)=>{
if(req.body.code==='123') req.session.formAccess=true;
res.redirect('/users/choice');
});

/* ================= CHOICE ================= */
app.get('/users/choice',requireLogin,(req,res)=>{
res.send(`
<h2 style="text-align:center">Gestion</h2>
<div style="text-align:center">
<a href="/users/lookup?mode=new">Nouveau</a><br>
<a href="/users/lookup?mode=edit">Modifier</a><br>
<a href="/users/lookup?mode=delete">Supprimer</a><br>
<a href="/users/all">Liste</a><br>
<a href="/logout">Déconnexion</a>
</div>
`);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup',requireLogin,(req,res)=>{
req.session.choiceMode=req.query.mode;
res.send(`
<form method="post" style="text-align:center;margin-top:60px">
<input name="phone" placeholder="Téléphone" required>
<button>Continuer</button>
</form>
`);
});

app.post('/users/lookup',requireLogin,async(req,res)=>{
const u=await User.findOne({senderPhone:req.body.phone}).sort({createdAt:-1});
req.session.prefill=u||{senderPhone:req.body.phone};
req.session.editId=u?u._id:null;
if(req.session.choiceMode==='delete' && u){
await User.findByIdAndDelete(u._id);
return res.redirect('/users/choice');
}
res.redirect('/users/form');
});

/* ================= FORM ================= */
app.get('/users/form',requireLogin,(req,res)=>{
const u=req.session.prefill||{};
res.send(`
<form id="f" style="max-width:500px;margin:auto">
<input id="senderPhone" value="${u.senderPhone||''}" placeholder="Téléphone"><br>
<input id="amount" type="number" value="${u.amount||''}" placeholder="Montant"><br>
<input id="fees" type="number" value="${u.fees||''}" placeholder="Frais"><br>
<input id="recoveryAmount" readonly><br>
<button>Enregistrer</button>
</form>
<script>
const a=amount,f=fees,r=recoveryAmount;
function c(){r.value=(+a.value||0)-(+f.value||0);}
a.oninput=c;f.oninput=c;c();
f.onsubmit=async e=>{
e.preventDefault();
const res=await fetch('/users',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({senderPhone:senderPhone.value,amount:+a.value,fees:+f.value,recoveryAmount:+r.value})});
alert((await res.json()).message);
}
</script>
`);
});

/* ================= CRUD ================= */
app.post('/users',requireLogin,async(req,res)=>{
const code=Math.random().toString().slice(2,8);
await new User({...req.body,code}).save();
res.json({message:'OK code '+code});
});

/* ================= LIST ================= */
app.get('/users/all',requireLogin,async(req,res)=>{
const users=await User.find();
res.send(users.map(u=>`${u.senderPhone} ${u.amount}`).join('<br>'));
});

app.get('/all',(req,res)=>res.redirect('/users/all'));

/* ================= PDF ================= */
app.get('/users/export/pdf',requireLogin,async(req,res)=>{
const users=await User.find();
const doc=new PDFDocument();
res.setHeader('Content-Type','application/pdf');
doc.pipe(res);
users.forEach(u=>doc.text(u.senderPhone+' '+u.amount));
doc.end();
});

/* ================= SERVER ================= */
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Server '+PORT));
