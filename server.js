/******************************************************************
 * APP TRANSFERT – VERSION FINALE POUR RENDER
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
app.use(session({ secret: 'transfert-secret-final', resave: true, saveUninitialized: true }));

/* ================= DATABASE ================= */
// Utilise l'URI MongoDB de Render ou Atlas
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('Erreur MongoDB:', err); process.exit(1); });

/* ================= CONSTANTES ================= */
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];
const userTypes = ['Client','Distributeur','Administrateur','Agence de transfert'];

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({username:String,password:String});
const User = mongoose.model('User', userSchema);

const transfertSchema = new mongoose.Schema({
  userType:String,
  senderFirstName:String,senderLastName:String,senderPhone:String,originLocation:String,
  receiverFirstName:String,receiverLastName:String,receiverPhone:String,destinationLocation:String,
  amount:Number,fees:Number,recoveryAmount:Number,currency:String,recoveryMode:String,
  retired:{type:Boolean,default:false},code:{type:String,unique:true},retraitHistory:[{date:Date,mode:String}],
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  location:String,currency:String,balance:{type:Number,default:0}
});
stockSchema.index({location:1,currency:1},{unique:true});
const Stock = mongoose.model('Stock', stockSchema);

/* ================= UTILS ================= */
function auth(req,res,next){ if(req.session.user) return next(); res.redirect('/login'); }
async function genCode(){let c; do{c=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);}while(await Transfert.findOne({code:c})); return c;}
async function getStock(l,c){let s=await Stock.findOne({location:l,currency:c}); if(!s)s=await new Stock({location:l,currency:c}).save(); return s;}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>res.send(loginHTML()));
app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let u=await User.findOne({username});
  if(!u) u=await new User({username,password:bcrypt.hashSync(password,10)}).save();
  if(!bcrypt.compareSync(password,u.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/transferts');
});
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= FORMULAIRE TRANSFERT ================= */
app.get('/transfert',auth,async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t ? t.code : await genCode();
  res.send(transfertFormHTML(t, code));
});

app.post('/transfert',auth,async(req,res)=>{
  const amount=Number(req.body.amount||0);
  const fees=Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code=req.body.code || await genCode();
  let existing = await Transfert.findOne({code});
  if(existing){
    await Transfert.findByIdAndUpdate(existing._id,{...req.body,amount,fees,recoveryAmount});
  }else{
    await new Transfert({...req.body,amount,fees,recoveryAmount,code,retraitHistory:[]}).save();
  }
  res.redirect('/transferts');
});

/* ================= LISTE + RECHERCHE + TOTAUX ================= */
app.get('/transferts',auth,async(req,res)=>{
  const search=(req.query.search||'').toLowerCase();
  const page = parseInt(req.query.page||1);
  const limit = 20;

  let list = await Transfert.find().sort({createdAt:-1});
  if(search) list=list.filter(t=>
    t.code.toLowerCase().includes(search) ||
    t.senderFirstName.toLowerCase().includes(search) ||
    t.senderLastName.toLowerCase().includes(search) ||
    t.receiverFirstName.toLowerCase().includes(search) ||
    t.receiverLastName.toLowerCase().includes(search)
  );

  const totalPages=Math.ceil(list.length/limit);
  const paginated=list.slice((page-1)*limit,page*limit);

  // Totaux par destination/devise
  const totals={};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]=0;
    totals[t.destinationLocation][t.currency]+=t.recoveryAmount;
  });

  res.send(listHTML(paginated,totals,search,page,totalPages));
});

/* ================= ACTIONS ================= */
app.post('/retirer',auth,async(req,res)=>{
  const t=await Transfert.findById(req.body.id);
  const s=await getStock(t.destinationLocation,t.currency);
  if(s.balance<t.recoveryAmount) return res.json({error:'Stock insuffisant'});
  s.balance-=t.recoveryAmount;
  t.retired=true; t.recoveryMode=req.body.mode;
  t.retraitHistory.push({date:new Date(),mode:req.body.mode});
  await s.save(); await t.save();
  res.json({ok:true,rest:s.balance});
});

app.post('/delete',auth,async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); });

/* ================= STOCK ================= */
app.get('/stock',auth,async(req,res)=>res.send(stockHTML(await Stock.find())));
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
  list.forEach(t=>doc.text(`${t.code} | ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName} | ${t.amount} ${t.currency} | ${t.recoveryAmount} | ${t.destinationLocation} | ${t.retired?'Retiré':'Non retiré'}`));
  doc.end();
});

/* ================= EXPORT EXCEL ================= */
app.get('/export/excel',auth,async(req,res)=>{
  const list=await Transfert.find();
  const wb=new ExcelJS.Workbook();
  const sh=wb.addWorksheet('Transferts');
  sh.columns=[
    {header:'Code',key:'code'},{header:'Type',key:'userType'},{header:'Expéditeur',key:'sender'},
    {header:'Origine',key:'originLocation'},{header:'Destinataire',key:'receiver'},
    {header:'Destination',key:'destinationLocation'},{header:'Montant',key:'amount'},
    {header:'Frais',key:'fees'},{header:'Reçu',key:'recoveryAmount'},
    {header:'Devise',key:'currency'},{header:'Statut',key:'status'},{header:'Date',key:'createdAt'}
  ];
  list.forEach(t=>sh.addRow({
    code:t.code,
    userType:t.userType,
    sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
    originLocation:t.originLocation,
    receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
    destinationLocation:t.destinationLocation,
    amount:t.amount,
    fees:t.fees,
    recoveryAmount:t.recoveryAmount,
    currency:t.currency,
    status:t.retired?'Retiré':'Non retiré',
    createdAt:t.createdAt.toLocaleString()
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await wb.xlsx.write(res);res.end();
});

/* ================= HTML TEMPLATES ================= */
function loginHTML(){return`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
.box{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
.box h2{margin-bottom:30px;color:#ff8c42;}
.box input, .box button{width:100%;padding:15px;margin:10px 0;border-radius:10px;}
.box button{background:#ff8c42;color:white;border:none;font-weight:bold;cursor:pointer;}
.box button:hover{background:#e67300;}
</style></head>
<body>
<div class="box">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div>
</body></html>`}

// Les fonctions transfertFormHTML(), stockHTML(), listHTML() restent identiques à celles données dans le code précédent.

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur lancé sur le port ${PORT}`));
