/******************************************************************
 * APPLICATION TRANSFERT – VERSION PRO FINALE
 ******************************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'secret-transfert-pro',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert_pro')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{ console.error(err); process.exit(1); });

/* ================= MODELS ================= */
const roleSchema = new mongoose.Schema({
  name:String,
  permissions:[String]
});
const Role = mongoose.model('Role', roleSchema);

const agencySchema = new mongoose.Schema({
  name:String,
  city:String
});
const Agency = mongoose.model('Agency', agencySchema);

const userSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{ type:mongoose.Schema.Types.ObjectId, ref:'Role' },
  agency:{ type:mongoose.Schema.Types.ObjectId, ref:'Agency' }
});
const User = mongoose.model('User', userSchema);

const counterSchema = new mongoose.Schema({
  year:Number,
  seq:Number
});
const Counter = mongoose.model('Counter', counterSchema);

const transfertSchema = new mongoose.Schema({
  receiptNumber:String,
  agency:{ type:mongoose.Schema.Types.ObjectId, ref:'Agency' },
  senderPhone:String,
  receiverPhone:String,
  destination:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  retired:{ type:Boolean, default:false },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

/* ================= HELPERS ================= */
async function generateReceipt(){
  const year = new Date().getFullYear();
  let c = await Counter.findOne({ year });
  if(!c) c = await Counter.create({ year, seq:1 });
  else c.seq++;
  await c.save();
  return `TRF-${year}-${String(c.seq).padStart(6,'0')}`;
}

function requireLogin(req,res,next){
  if(!req.session.user) return res.redirect('/login');
  next();
}

function hasPermission(p){
  return (req,res,next)=>{
    if(req.session.user.permissions.includes(p) || req.session.user.permissions.includes('all'))
      return next();
    res.send('⛔ Accès refusé');
  };
}

/* ================= AUTH ================= */
app.get('/login',(req,res)=>{
res.send(`
<style>${css}</style>
<div class="login">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Connexion</button>
</form>
</div>
`);
});

app.post('/login', async(req,res)=>{
  const u = await User.findOne({ username:req.body.username }).populate('role agency');
  if(!u || !bcrypt.compareSync(req.body.password,u.password))
    return res.send('Identifiants incorrects');

  req.session.user={
    id:u._id,
    username:u.username,
    role:u.role.name,
    permissions:u.role.permissions,
    agency:u.agency
  };
  res.redirect('/transferts');
});

/* ================= TRANSFERTS ================= */
app.get('/transferts', requireLogin, async(req,res)=>{
  const user=req.session.user;
  const filter = user.role==='superadmin' ? {} : { agency:user.agency._id };
  const data = await Transfert.find(filter).sort({createdAt:-1});

  let html=`
<style>${css}</style>
<div class="container">
<h2>Liste des transferts – ${user.agency.name}</h2>
<table>
<tr>
<th>Reçu</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th>
</tr>`;

  data.forEach(t=>{
    html+=`
<tr class="${t.retired?'retired':''}">
<td>${t.receiptNumber}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
${user.permissions.includes('retirer') && !t.retired ? `
<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<button>Retirer</button>
</form>`:''}
${user.permissions.includes('imprimer') ? `
<a href="/transferts/print/${t._id}" target="_blank"><button>Imprimer</button></a>`:''}
</td>
</tr>`;
  });

  html+=`</table></div>`;
  res.send(html);
});

/* ================= RETIRER ================= */
app.post('/transferts/retirer', requireLogin, hasPermission('retirer'), async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{ retired:true });
  res.redirect('/transferts');
});

/* ================= PRINT ================= */
app.get('/transferts/print/:id', requireLogin, hasPermission('imprimer'), async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.send(`
<body onload="window.print()" style="width:280px;font-family:Arial">
<b>${t.receiptNumber}</b><br>
Montant: ${t.amount} ${t.currency}<br>
Destinataire: ${t.receiverPhone}<br>
Statut: ${t.retired?'Retiré':'Non retiré'}
</body>
`);
});

/* ================= CSS RESPONSIVE ================= */
const css=`
body{font-family:Arial;background:#f4f6f9;margin:0}
.container{padding:10px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:8px;font-size:14px}
th{background:#007bff;color:white}
.retired{background:#fff3cd}
button{padding:6px 10px;margin:2px}
.login{max-width:300px;margin:100px auto;background:white;padding:20px}
input{width:100%;padding:8px;margin-bottom:10px}
@media(max-width:600px){
table{font-size:12px}
}
`;

/* ================= START ================= */
app.listen(3000,()=>console.log('🚀 Serveur prêt sur http://localhost:3000'));
