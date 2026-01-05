/******************************************************************
 * APP TRANSFERT ENTREPRISE - FICHIER UNIQUE FINAL
 ******************************************************************/
require('dotenv').config();
const express=require('express');
const mongoose=require('mongoose');
const session=require('express-session');
const bcrypt=require('bcryptjs');
const PDFDocument=require('pdfkit');
const QRCode=require('qrcode');

const app=express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.use(session({
 secret:'secret',
 resave:false,
 saveUninitialized:false
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert_enterprise');

/* ================= SCHEMAS ================= */
const User=mongoose.model('User',new mongoose.Schema({
 username:String,password:String,role:String
}));

const Audit=mongoose.model('Audit',new mongoose.Schema({
 user:String,role:String,action:String,target:String,createdAt:{type:Date,default:Date.now}
}));

const Rate=mongoose.model('Rate',new mongoose.Schema({
 from:String,to:String,rate:Number
}));

const Client=mongoose.model('Client',new mongoose.Schema({
 name:String,phone:String,createdAt:{type:Date,default:Date.now}
}));

const Stock=mongoose.model('Stock',new mongoose.Schema({
 location:String,amount:Number,currency:String,createdAt:{type:Date,default:Date.now}
}));

const Transfert=mongoose.model('Transfert',new mongoose.Schema({
 code:String,
 sender:String,senderPhone:String,
 receiver:String,receiverPhone:String,
 origin:String,destination:String,
 amount:Number,fees:Number,currency:String,
 retired:{type:Boolean,default:false},
 createdAt:{type:Date,default:Date.now}
}));

/* ================= UTILS ================= */
const genCode=()=>Math.random().toString(36).substring(2,7).toUpperCase();

const perms=r=>({
 a:{read:1,write:0,delete:0,retire:1},
 admin2:{read:1,write:1,delete:1,retire:0},
 admin:{read:1,write:1,delete:1,retire:1}
}[r]);

const auth=(req,res,next)=>req.session.user?next():res.redirect('/login');
const can=p=>(req,res,next)=>req.session.user.perm[p]?next():res.sendStatus(403);

const log=async(req,action,target)=>{
 await Audit.create({user:req.session.user.username,role:req.session.user.role,action,target});
};

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>res.send(`
<html><body style="font-family:Arial;background:#f4f6f9">
<form method="post" style="width:300px;margin:100px auto;background:#fff;padding:20px;border-radius:10px">
<h3>Connexion</h3>
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Login</button>
</form>
</body></html>
`));

app.post('/login',async(req,res)=>{
 let u=await User.findOne({username:req.body.username});
 if(!u){
  u=await new User({
   username:req.body.username,
   password:bcrypt.hashSync(req.body.password,10),
   role:req.body.username
  }).save();
 }
 if(!bcrypt.compareSync(req.body.password,u.password))return res.send('Erreur');
 req.session.user={username:u.username,role:u.role,perm:perms(u.role)};
 res.redirect('/');
});

app.get('/logout',(r,s)=>r.session.destroy(()=>s.redirect('/login')));

/* ================= DASHBOARD ================= */
app.get('/',auth,(req,res)=>res.send(`
<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
button{padding:6px 10px;border:none;border-radius:5px;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border:1px solid #ccc;padding:6px}
th{background:#ff8c42;color:#fff}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);justify-content:center;align-items:center}
.box{background:#fff;padding:20px;border-radius:10px;width:300px}
</style>
</head>
<body>

<h2>Dashboard – ${req.session.user.role}</h2>
<a href="/logout">Déconnexion</a>

<h3>Transferts</h3>
<input id="search" placeholder="Code / Téléphone">
<button onclick="load()">🔍</button>
<button onclick="open()">➕</button>

<table>
<thead><tr><th>Code</th><th>Exp</th><th>Dest</th><th>Montant</th><th>Statut</th><th>Actions</th></tr></thead>
<tbody id="tb"></tbody>
</table>

<div class="modal" id="m">
<div class="box">
<input id="s" placeholder="Expéditeur">
<input id="sp" placeholder="Téléphone exp">
<input id="r" placeholder="Destinataire">
<input id="rp" placeholder="Téléphone dest">
<input id="o" placeholder="Origine">
<input id="d" placeholder="Destination">
<input id="a" type="number" placeholder="Montant">
<input id="f" type="number" placeholder="Frais">
<select id="c"><option>GNF</option><option>EUR</option></select>
<button onclick="save()">💾</button>
<button onclick="close()">✖</button>
</div>
</div>

<script>
let id=null;
async function load(){
 const q=search.value;
 const r=await fetch('/api/transferts?q='+q);
 const d=await r.json();
 tb.innerHTML='';
 d.forEach(t=>{
 tb.innerHTML+=\`
<tr>
<td>\${t.code}</td>
<td>\${t.sender}</td>
<td>\${t.receiver}</td>
<td>\${t.amount} \${t.currency}</td>
<td>\${t.retired?'✔':'❌'}</td>
<td>
<button onclick="printT('\${t._id}')">🖨</button>
<button onclick="edit('\${t._id}')">✏</button>
<button onclick="del('\${t._id}')">🗑</button>
<button onclick="retire('\${t._id}')">💸</button>
</td>
</tr>\`;
 });
}
load();

function open(){m.style.display='flex'}
function close(){m.style.display='none';id=null}
async function save(){
 await fetch('/api/transferts',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({_id:id,sender:s.value,senderPhone:sp.value,receiver:r.value,receiverPhone:rp.value,
 origin:o.value,destination:d.value,amount:+a.value,fees:+f.value,currency:c.value})});
 close();load();
}
async function edit(i){
 const r=await fetch('/api/transferts');
 const t=(await r.json()).find(x=>x._id===i);
 id=i;
 s.value=t.sender;sp.value=t.senderPhone;r.value=t.receiver;rp.value=t.receiverPhone;
 o.value=t.origin;d.value=t.destination;a.value=t.amount;f.value=t.fees;c.value=t.currency;
 open();
}
async function del(i){await fetch('/api/transferts/'+i,{method:'DELETE'});load();}
async function retire(i){await fetch('/api/transferts/'+i+'/retire',{method:'POST'});load();}
function printT(i){window.open('/print/'+i,'_blank');}
</script>
</body></html>
`));

/* ================= API ================= */
app.get('/api/transferts',auth,async(req,res)=>{
 const q={};
 if(req.query.q)
  q.$or=[{code:req.query.q},{senderPhone:req.query.q},{receiverPhone:req.query.q}];
 res.json(await Transfert.find(q).sort({createdAt:-1}));
});

app.post('/api/transferts',auth,can('write'),async(req,res)=>{
 if(req.body._id) await Transfert.findByIdAndUpdate(req.body._id,req.body);
 else await new Transfert({...req.body,code:genCode()}).save();
 await log(req,'SAVE','TRANSFERT');
 res.json({ok:true});
});

app.delete('/api/transferts/:id',auth,can('delete'),async(req,res)=>{
 await Transfert.findByIdAndDelete(req.params.id);
 await log(req,'DELETE','TRANSFERT');
 res.json({ok:true});
});

app.post('/api/transferts/:id/retire',auth,can('retire'),async(req,res)=>{
 await Transfert.findByIdAndUpdate(req.params.id,{retired:true});
 await log(req,'RETIRE','TRANSFERT');
 res.json({ok:true});
});

app.get('/print/:id',auth,async(req,res)=>{
 const t=await Transfert.findById(req.params.id);
 if(!t) return res.send('Introuvable');

 res.send(`
 <html>
 <head>
 <meta name="viewport" content="width=device-width, initial-scale=1">
 <style>
 body{font-family:Arial;margin:20px}
 h2{color:#ff8c42}
 p{margin:5px 0}
 </style>
 </head>
 <body onload="window.print()">
   <h2>🧾 Reçu Transfert</h2>
   <p><b>Code :</b> ${t.code}</p>
   <p><b>Expéditeur :</b> ${t.sender} (${t.senderPhone})</p>
   <p><b>Destinataire :</b> ${t.receiver} (${t.receiverPhone})</p>
   <p><b>Origine :</b> ${t.origin}</p>
   <p><b>Destination :</b> ${t.destination}</p>
   <p><b>Montant :</b> ${t.amount} ${t.currency}</p>
   <p><b>Frais :</b> ${t.fees}</p>
   <p><b>Statut :</b> ${t.retired?'RETIRÉ':'NON RETIRÉ'}</p>
   <hr>
   <p style="font-size:12px">Imprimé le ${new Date().toLocaleString()}</p>
 </body>
 </html>
 `);
});

/* ================= START ================= */
app.listen(3000,()=>console.log('🚀 http://localhost:3000'));
