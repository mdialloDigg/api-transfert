/******************************************************************
 * APP TRANSFERT – VERSION FINALE AVEC TICKET
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret',
  resave: false,
  saveUninitialized: true
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */
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
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists = await Transfert.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
`);
});

app.post('/login',async(req,res)=>{
  let u = await Auth.findOne({username:req.body.username});
  if(!u){
    u = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,u.password))
    return res.send('Mot de passe incorrect');
  req.session.user=u;
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= FORM ================= */
app.get('/transferts/form',requireLogin,async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t ? t.code : await generateUniqueCode();
res.send(`
<h2>${t?'Modifier':'Nouveau'} transfert</h2>
<form method="post">
<input name="senderFirstName" placeholder="Expéditeur prénom" value="${t?.senderFirstName||''}">
<input name="senderLastName" placeholder="Expéditeur nom" value="${t?.senderLastName||''}">
<input name="senderPhone" placeholder="Téléphone expéditeur" value="${t?.senderPhone||''}">
<hr>
<input name="receiverFirstName" placeholder="Destinataire prénom" value="${t?.receiverFirstName||''}">
<input name="receiverLastName" placeholder="Destinataire nom" value="${t?.receiverLastName||''}">
<input name="receiverPhone" placeholder="Téléphone destinataire" value="${t?.receiverPhone||''}">
<hr>
<input name="amount" placeholder="Montant" value="${t?.amount||''}">
<input name="fees" placeholder="Frais" value="${t?.fees||''}">
<input name="currency" placeholder="Devise" value="${t?.currency||'GNF'}">
<input name="code" value="${code}" readonly>
<button>Enregistrer</button>
</form>
<a href="/transferts/list">Retour</a>
`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
  const amount=+req.body.amount||0;
  const fees=+req.body.fees||0;
  const recoveryAmount=amount-fees;
  let t = await Transfert.findOne({code:req.body.code});
  if(t) await Transfert.findByIdAndUpdate(t._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount,code:req.body.code}).save();
  res.redirect('/transferts/list');
});

/* ================= LIST ================= */
app.get('/transferts/list',requireLogin,async(req,res)=>{
  const list = await Transfert.find().sort({createdAt:-1});
  let html=`<h2>Liste transferts</h2><a href="/transferts/form">Nouveau</a><table border=1>
<tr><th>Code</th><th>Montant</th><th>Statut</th><th>Actions</th></tr>`;
  list.forEach(t=>{
    html+=`
<tr>
<td>${t.code}</td>
<td>${t.amount}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<a href="/transferts/form?code=${t.code}">✏️</a>
<a href="/transferts/print/${t._id}" target="_blank">🖨</a>
<a href="/transferts/ticket/pdf/${t._id}" target="_blank">📄</a>
</td>
</tr>`;
  });
  html+='</table>';
  res.send(html);
});

/* ================= TICKET HTML ================= */
app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.send(`
<body onload="window.print();setTimeout(()=>window.close(),500)">
<div style="width:260px;border:1px dashed;padding:10px;font-family:Arial">
<h3 align=center>REÇU TRANSFERT</h3>
Code: ${t.code}<br>
Montant: ${t.amount} ${t.currency}<br>
Frais: ${t.fees}<br>
À recevoir: ${t.recoveryAmount}<br>
Statut: ${t.retired?'Retiré':'Non retiré'}<br>
<hr>
${new Date(t.createdAt).toLocaleString()}
</div>
</body>
`);
});

/* ================= TICKET PDF ================= */
app.get('/transferts/ticket/pdf/:id',requireLogin,async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  const doc = new PDFDocument({size:[226,600],margin:10});
  res.setHeader('Content-Type','application/pdf');
  doc.pipe(res);
  doc.text('AGENCE DE TRANSFERT',{align:'center'});
  doc.text(`Code: ${t.code}`);
  doc.text(`Montant: ${t.amount} ${t.currency}`);
  doc.text(`Frais: ${t.fees}`);
  doc.text(`À recevoir: ${t.recoveryAmount}`);
  doc.text(`Statut: ${t.retired?'Retiré':'Non retiré'}`);
  doc.text(new Date(t.createdAt).toLocaleString());
  doc.end();
});

/* ================= START ================= */
app.listen(3000,()=>console.log('🚀 http://localhost:3000'));
