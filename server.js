/************************************************
 * APP TRANSFERT – VERSION FINALE UNIQUE
 * Desktop + Mobile + PWA
 ************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(helmet());

app.use(session({
  name: 'transfert.sid',
  secret: process.env.SESSION_SECRET || 'secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

/* ================= DATABASE ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= MODELS ================= */
const transfertSchema = new mongoose.Schema({
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
transfertSchema.index({ code:1 },{ unique:true });
const Transfert = mongoose.model('Transfert', transfertSchema);

const userSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String,default:'agent'}
});
const User = mongoose.model('User', userSchema);

/* ================= INIT ADMIN AUTO ================= */
(async()=>{
  if(!await User.findOne({username:'admin'})){
    await new User({
      username:'admin',
      password:bcrypt.hashSync('admin',10),
      role:'admin'
    }).save();
    console.log('👤 Admin créé (admin / admin)');
  }
})();

/* ================= UTILS ================= */
async function generateCode(){
  let code;
  do{
    code = crypto.randomBytes(2).toString('hex').toUpperCase();
  }while(await Transfert.exists({code}));
  return code;
}

const requireLogin=(req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ================= PWA FILES ================= */
app.get('/manifest.json',(req,res)=>{
  res.json({
    name:"Transfert Money",
    short_name:"Transfert",
    start_url:"/transferts",
    display:"standalone",
    theme_color:"#007bff",
    background_color:"#ffffff"
  });
});

app.get('/sw.js',(req,res)=>{
res.type('application/javascript').send(`
self.addEventListener('fetch',e=>{
  e.respondWith(fetch(e.request).catch(()=>new Response('Offline')))
});
`);
});

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<!doctype html><html><head>
<meta name=viewport content="width=device-width,initial-scale=1">
<link rel=manifest href=/manifest.json>
<style>
body{font-family:Arial;background:#f4f6f9;text-align:center;padding-top:80px}
form{background:#fff;padding:30px;border-radius:12px;display:inline-block}
input,button{width:240px;padding:12px;margin:6px;font-size:16px}
button{background:#007bff;color:#fff;border:none}
</style></head><body>
<form method=post>
<h2>Connexion</h2>
<input name=username placeholder=Utilisateur required>
<input type=password name=password placeholder="Mot de passe" required>
<button>Connexion</button>
</form>
<script>
if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js')}
</script>
</body></html>
`);
});

app.post('/login',async(req,res)=>{
  const u=await User.findOne({username:req.body.username});
  if(!u||!bcrypt.compareSync(req.body.password,u.password))
    return res.send('Accès refusé');
  req.session.user={username:u.username};
  res.redirect('/transferts');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= LISTE ================= */
app.get('/transferts',requireLogin,async(req,res)=>{
  const list=await Transfert.find().sort({createdAt:-1}).lean();
res.send(`
<!doctype html><html><head>
<meta name=viewport content="width=device-width,initial-scale=1">
<link rel=manifest href=/manifest.json>
<style>
body{font-family:Arial;background:#f4f6f9;padding:10px}
.desktop{display:block}.mobile{display:none}
@media(max-width:768px){.desktop{display:none}.mobile{display:block}}
table{width:100%;background:#fff;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:6px}
.card{background:#fff;padding:12px;border-radius:12px;margin-bottom:10px}
button{padding:10px;border:none;border-radius:6px}
.green{background:#28a745;color:#fff}
</style></head><body>
<h2>📋 Transferts</h2>
<a href=/new><button class=green>➕ Nouveau</button></a>
<a href=/logout><button>🚪 Quitter</button></a>

<table class=desktop>
<tr><th>Code</th><th>Exp</th><th>Dest</th><th>Montant</th></tr>
${list.map(t=>`
<tr><td>${t.code}</td>
<td>${t.senderFirstName}</td>
<td>${t.receiverFirstName}</td>
<td>${t.amount} ${t.currency}</td></tr>`).join('')}
</table>

<div class=mobile>
${list.map(t=>`
<div class=card>
<b>${t.amount} ${t.currency}</b><br>
Code: ${t.code}<br>
${t.senderFirstName} → ${t.receiverFirstName}
</div>`).join('')}
</div>

<script>
if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js')}
</script>
</body></html>
`);
});

/* ================= NEW ================= */
app.get('/new',requireLogin,async(req,res)=>{
const code=await generateCode();
res.send(`
<!doctype html><html><head>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9;padding:10px}
input,button{width:100%;padding:14px;margin:6px;font-size:16px}
button{background:#28a745;color:#fff;border:none}
</style></head><body>
<h2>Nouveau transfert</h2>
<form method=post>
<input name=senderFirstName placeholder="Expéditeur" required>
<input name=receiverFirstName placeholder="Destinataire" required>
<input type=number name=amount placeholder="Montant" required>
<input type=number name=fees placeholder="Frais" required>
<input name=currency value="GNF">
<input name=code readonly value=${code}>
<button>Enregistrer</button>
</form>
</body></html>
`);
});

app.post('/new',requireLogin,async(req,res)=>{
  const a=+req.body.amount,f=+req.body.fees;
  await new Transfert({...req.body,amount:a,fees:f,recoveryAmount:a-f}).save();
  res.redirect('/transferts');
});

/* ================= START ================= */
const PORT=3000;
app.listen(PORT,()=>console.log('🚀 http://localhost:'+PORT));
