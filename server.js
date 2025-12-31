/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLÈTE (1 → 5)
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

/* ================= SESSION ================= */
app.use(session({
  secret: 'transfert-secret-final',
  resave: true,
  saveUninitialized: true
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{console.error(err);process.exit(1);});

/* ================= CONSTANTES ================= */
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  username:String,
  password:String
});
const User = mongoose.model('User', userSchema);

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
  recoveryMode:String,
  retired:{type:Boolean,default:false},
  code:String,
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  location:String,
  currency:String,
  balance:{type:Number,default:0}
});
stockSchema.index({location:1,currency:1},{unique:true});
const Stock = mongoose.model('Stock', stockSchema);

/* ================= UTILS ================= */
function auth(req,res,next){
  if(req.session.user) return next();
  res.redirect('/login');
}
async function genCode(){
  let c;
  do{
    c = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
  }while(await Transfert.findOne({code:c}));
  return c;
}
async function getStock(l,c){
  let s = await Stock.findOne({location:l,currency:c});
  if(!s) s = await new Stock({location:l,currency:c}).save();
  return s;
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>res.send(loginHTML()));
app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let u = await User.findOne({username});
  if(!u){
    u = await new User({username,password:bcrypt.hashSync(password,10)}).save();
  }
  if(!bcrypt.compareSync(password,u.password))
    return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/transferts');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= FORM ================= */
app.get('/transfert',auth,async(req,res)=>{
  res.send(formHTML(await genCode()));
});
app.post('/transfert',auth,async(req,res)=>{
  const amount=Number(req.body.amount);
  const fees=Number(req.body.fees);
  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount:amount-fees
  }).save();
  res.redirect('/transferts');
});

/* ================= LISTE + RECHERCHE + TOTAUX ================= */
app.get('/transferts',auth,async(req,res)=>{
  const search=(req.query.search||'').toLowerCase();
  let list=await Transfert.find().sort({createdAt:-1});
  if(search){
    list=list.filter(t=>
      t.code.toLowerCase().includes(search) ||
      t.senderFirstName.toLowerCase().includes(search) ||
      t.receiverFirstName.toLowerCase().includes(search)
    );
  }

  const totals={};
  list.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency])
      totals[t.destinationLocation][t.currency]=0;
    totals[t.destinationLocation][t.currency]+=t.recoveryAmount;
  });

  res.send(listHTML(list,totals,search));
});

/* ================= ACTIONS ================= */
app.post('/retirer',auth,async(req,res)=>{
  const t=await Transfert.findById(req.body.id);
  const s=await getStock(t.destinationLocation,t.currency);
  if(s.balance<t.recoveryAmount)
    return res.json({error:'Stock insuffisant'});
  s.balance-=t.recoveryAmount;
  t.retired=true;
  t.recoveryMode=req.body.mode;
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
  const s=await getStock(req.body.location,req.body.currency);
  s.balance+=Number(req.body.amount);
  await s.save();
  res.redirect('/stock');
});

/* ================= EXPORT PDF ================= */
app.get('/export/pdf',auth,async(req,res)=>{
  const list=await Transfert.find();
  const doc=new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  doc.pipe(res);
  list.forEach(t=>{
    doc.text(`${t.code} - ${t.recoveryAmount} ${t.currency} - ${t.destinationLocation}`);
  });
  doc.end();
});

/* ================= EXPORT EXCEL ================= */
app.get('/export/excel',auth,async(req,res)=>{
  const list=await Transfert.find();
  const wb=new ExcelJS.Workbook();
  const sh=wb.addWorksheet('Transferts');
  sh.columns=[
    {header:'Code',key:'code'},
    {header:'Ville',key:'destinationLocation'},
    {header:'Montant',key:'recoveryAmount'},
    {header:'Devise',key:'currency'}
  ];
  list.forEach(t=>sh.addRow(t));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);res.end();
});

/* ================= HTML ================= */
function loginHTML(){return`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);
display:flex;justify-content:center;align-items:center;height:100vh;}
.box{background:#fff;padding:40px;border-radius:20px;
box-shadow:0 10px 30px rgba(0,0,0,.3);width:90%;max-width:360px;text-align:center;}
input,button{width:100%;padding:15px;margin:10px 0;border-radius:10px;}
button{background:#ff8c42;color:#fff;border:none;font-weight:bold;}
</style></head><body>
<div class="box"><h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur">
<input type="password" name="password" placeholder="Mot de passe">
<button>Se connecter</button>
</form></div></body></html>`}

function formHTML(code){return`
<h2>Nouveau transfert</h2>
<form method="post">
<input name="senderFirstName" placeholder="Expéditeur">
<input name="receiverFirstName" placeholder="Destinataire">
<input name="amount" type="number" placeholder="Montant">
<input name="fees" type="number" placeholder="Frais">
<select name="currency">${currencies.map(c=>`<option>${c}</option>`)}</select>
<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`)}</select>
<input name="code" readonly value="${code}">
<button>Enregistrer</button>
</form><a href="/transferts">⬅ Retour</a>`}

function listHTML(list,totals,search){return`
<h2>Transferts</h2>
<form>
<input name="search" value="${search}" placeholder="Recherche">
<button>🔍</button>
</form>
<a href="/transfert">➕</a> | <a href="/stock">🏦</a> |
<a href="/export/pdf">PDF</a> | <a href="/export/excel">Excel</a> |
<a href="/logout">🚪</a>

<h3>Totaux</h3>
${Object.keys(totals).map(v=>Object.keys(totals[v]).map(c=>
`<div>${v} - ${c} : ${totals[v][c]}</div>`).join('')).join('')}

<table border="1">
<tr><th>Code</th><th>Ville</th><th>Montant</th><th>Status</th><th>Action</th></tr>
${list.map(t=>`
<tr data-id="${t._id}">
<td>${t.code}</td>
<td>${t.destinationLocation}</td>
<td>${t.recoveryAmount} ${t.currency}</td>
<td>${t.retired?'Retiré':'En attente'}</td>
<td>
${!t.retired?`
<select class="m">${retraitModes.map(m=>`<option>${m}</option>`).join('')}</select>
<button onclick="ret(this)">💰</button>`:''}
<button onclick="del(this)">❌</button>
</td></tr>`).join('')}
</table>
<script>
async function ret(b){
const tr=b.closest('tr');
await fetch('/retirer',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({id:tr.dataset.id,mode:tr.querySelector('.m').value})});
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
${s.map(x=>`<tr><td>${x.location}</td><td>${x.currency}</td><td>${x.balance}</td></tr>`).join('')}
</table>
<a href="/transferts">⬅ Retour</a>`}

/* ================= SERVER ================= */
app.listen(3000,'0.0.0.0',()=>console.log('🚀 http://localhost:3000'));
