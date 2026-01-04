/******************************************************************
 * APP TRANSFERT - VERSION FINALE TOUT EN UN
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express(); 

/******************** MIDDLEWARE *************************/

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-transfert',
  resave: false,
  saveUninitialized: false
}));

// ===== AUTH MIDDLEWARE (FIX RENDER ERROR) =====
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}


/******************** DATABASE *************************/
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log("✅ MongoDB connecté"))
.catch(err=>{console.error(err);process.exit(1);});




/******************** SCHEMAS *************************/
const Transfert = mongoose.model('Transfert', new mongoose.Schema({
  code:String,
  sender:String,
  receiver:String,
  amount:Number,
  fees:Number,
  received:Number,
  currency:String,
  retired:{type:Boolean,default:false},
  createdAt:{type:Date,default:Date.now}
}));

const Stock = mongoose.model('Stock', new mongoose.Schema({
  code:String,
  sender:String,
  destination:String,
  amount:Number,
  currency:String,
  createdAt:{type:Date,default:Date.now}
}));

const Client = mongoose.model('Client', new mongoose.Schema({
  firstName:String,
  lastName:String,
  phone:String,
  email:String,
  kyc:Boolean
}));

const Rate = mongoose.model('Rate', new mongoose.Schema({
  from:String,
  to:String,
  rate:Number
}));

const User = mongoose.model('User', new mongoose.Schema({
  username:String,
  password:String
}));

/******************** UTILS *************************/
const auth = (req,res,next)=>req.session.user?next():res.redirect('/login');
const genCode = ()=>Math.random().toString(36).substring(2,8).toUpperCase();

/******************** LOGIN *************************/
app.get('/login',(req,res)=>res.send(`
<html><style>
body{background:#111;color:white;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh}
.box{background:#222;padding:30px;border-radius:10px}
input,button{padding:10px;width:100%;margin:5px}
button{background:#ff8c42;border:none;color:white}
</style>
<form class="box" method="post">
<h2>Connexion</h2>
<input name="username" placeholder="Utilisateur">
<input name="password" type="password" placeholder="Mot de passe">
<button>Entrer</button>
</form></html>`));

app.post('/login',async(req,res)=>{
  let u = await User.findOne({username:req.body.username});
  if(!u){
    u = await new User({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,u.password)) return res.send("Erreur mot de passe");
  req.session.user=u;
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/******************** DASHBOARD *************************/
app.get('/dashboard',auth,async(req,res)=>{
  const t = await Transfert.find();
  const s = await Stock.find();
  const c = await Client.find();
  const r = await Rate.find();

res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{background:#111;color:white;font-family:Arial;padding:20px}
h2{color:#ff8c42}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th,td{border:1px solid #333;padding:8px}
th{background:#ff8c42}
button{padding:5px;margin:2px;border:none;border-radius:5px}
.add{background:#28a745;color:white}
.del{background:#dc3545;color:white}
.ret{background:#ffc107}
</style>
</head>
<body>

<h2>Dashboard</h2>
<a href="/logout" style="color:#ff8c42">Déconnexion</a>

<h3>Transferts</h3>
<button class="add" onclick="addT()">+</button>
<table>
<tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th></th></tr>
${t.map(x=>`
<tr>
<td>${x.code}</td>
<td>${x.sender}</td>
<td>${x.receiver}</td>
<td>${x.amount}</td>
<td>${x.fees}</td>
<td>${x.received}</td>
<td>${x.currency}</td>
<td>${x.retired?'Retiré':'Non'}</td>
<td>
<button class="ret" onclick="ret('${x._id}')">💰</button>
<button class="del" onclick="del('/transferts/${x._id}')">❌</button>
</td>
</tr>`).join('')}
</table>

<h3>Stocks</h3>
<button class="add" onclick="addS()">+</button>
<table>
<tr><th>Code</th><th>Sender</th><th>Destination</th><th>Montant</th><th>Devise</th><th></th></tr>
${s.map(x=>`
<tr>
<td>${x.code}</td><td>${x.sender}</td><td>${x.destination}</td>
<td>${x.amount}</td><td>${x.currency}</td>
<td><button class="del" onclick="del('/stocks/${x._id}')">❌</button></td>
</tr>`).join('')}
</table>

<h3>Clients KYC</h3>
<button class="add" onclick="addC()">+</button>
<table>
<tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th></th></tr>
${c.map(x=>`
<tr>
<td>${x.firstName} ${x.lastName}</td>
<td>${x.phone}</td>
<td>${x.email}</td>
<td>${x.kyc?'Oui':'Non'}</td>
<td><button class="del" onclick="del('/clients/${x._id}')">❌</button></td>
</tr>`).join('')}
</table>

<h3>Taux</h3>
<button class="add" onclick="addR()">+</button>
<table>
<tr><th>De</th><th>Vers</th><th>Taux</th><th></th></tr>
${r.map(x=>`
<tr>
<td>${x.from}</td><td>${x.to}</td><td>${x.rate}</td>
<td><button class="del" onclick="del('/rates/${x._id}')">❌</button></td>
</tr>`).join('')}
</table>

<h3>Exports</h3>
<button onclick="location='/export/transferts/excel'">Transferts Excel</button>
<button onclick="location='/export/transferts/pdf'">Transferts PDF</button>

<script>
function del(u){fetch(u,{method:'DELETE'}).then(()=>location.reload())}
function ret(id){fetch('/retirer/'+id,{method:'POST'}).then(()=>location.reload())}
function addT(){
 const s=prompt('Sender');const r=prompt('Receiver');
 const a=+prompt('Montant');const f=+prompt('Frais');const c=prompt('Devise');
 fetch('/transferts',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({sender:s,receiver:r,amount:a,fees:f,received:a-f,currency:c})}).then(()=>location.reload())
}
function addS(){
 fetch('/stocks',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({sender:prompt('Sender'),destination:prompt('Destination'),amount:+prompt('Montant'),currency:prompt('Devise')})}).then(()=>location.reload())
}
function addC(){
 fetch('/clients',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({firstName:prompt('Prénom'),lastName:prompt('Nom'),phone:prompt('Téléphone'),email:prompt('Email'),kyc:confirm('KYC ?')})}).then(()=>location.reload())
}
function addR(){
 fetch('/rates',{method:'POST',headers:{'Content-Type':'application/json'},
 body:JSON.stringify({from:prompt('De'),to:prompt('Vers'),rate:+prompt('Taux')})}).then(()=>location.reload())
}
</script>
</body></html>
`);
});

/******************** ROUTES API *************************/
app.post('/transferts',auth,async(req,res)=>{await new Transfert({...req.body,code:genCode()}).save();res.json(true)});
app.delete('/transferts/:id',auth,async(req,res)=>{await Transfert.findByIdAndDelete(req.params.id);res.json(true)});

app.post('/stocks',auth,async(req,res)=>{await new Stock({...req.body,code:genCode()}).save();res.json(true)});
app.delete('/stocks/:id',auth,async(req,res)=>{await Stock.findByIdAndDelete(req.params.id);res.json(true)});

app.post('/clients',auth,async(req,res)=>{await new Client(req.body).save();res.json(true)});
app.delete('/clients/:id',auth,async(req,res)=>{await Client.findByIdAndDelete(req.params.id);res.json(true)});

app.post('/rates',auth,async(req,res)=>{await new Rate(req.body).save();res.json(true)});
app.delete('/rates/:id',auth,async(req,res)=>{await Rate.findByIdAndDelete(req.params.id);res.json(true)});

/******************** EXPORTS *************************/
app.get('/export/transferts/excel',auth,async(req,res)=>{
 const wb=new ExcelJS.Workbook();const sh=wb.addWorksheet('Transferts');
 sh.addRow(['Code','Sender','Receiver','Montant','Frais','Reçu','Devise','Status']);
 (await Transfert.find()).forEach(x=>sh.addRow([x.code,x.sender,x.receiver,x.amount,x.fees,x.received,x.currency,x.retired]));
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
 await wb.xlsx.write(res);res.end();
});

app.get('/export/transferts/pdf',auth,async(req,res)=>{
 const doc=new PDFDocument();res.setHeader('Content-Type','application/pdf');
 res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
 doc.pipe(res);doc.fontSize(16).text('TRANSFERTS');doc.moveDown();
 (await Transfert.find()).forEach(x=>doc.text(`${x.code} ${x.sender}->${x.receiver} ${x.amount} ${x.currency}`));
 doc.end();
});


app.post('/transferts/retirer/:id', requireLogin, async(req,res)=>{
 try {
    const { id, mode } = req.body;

    // 1️⃣ Récupérer le transfert
    const transfert = await Transfert.findById(id);
    if (!transfert) {
      return res.status(404).json({ error: 'Transfert introuvable' });
    }

    if (transfert.retired) {
      return res.status(400).json({ error: 'Déjà retiré' });
    }

    const montantRetire = transfert.amount - transfert.fees;

    // 2️⃣ Trouver le stock correspondant
    const stock = await StockHistory.findOne({
      destination: transfert.destinationLocation,
      currency: transfert.currency
    });

    if (!stock) {
      return res.status(400).json({ error: 'Stock introuvable' });
    }

    if (stock.amount < montantRetire) {
      return res.status(400).json({ error: 'Stock insuffisant' });
    }

    // 3️⃣ Débiter le stock
    stock.amount = stock.amount - montantRetire;
    await stock.save();

    // 4️⃣ Marquer le transfert comme retiré
    transfert.retired = true;
    transfert.retraitHistory.push({
      date: new Date(),
      mode
    });
    await transfert.save();


  await Transfert.findByIdAndUpdate(req.params.id,{retired:true});
  res.json(true);


    // 5️⃣ Historique
    // await new StockHistory({
     //  code: transfert.code,
       //action: 'RETRAIT',
       //stockId: stock._id,
       //sender: `${transfert.senderFirstName} ${transfert.senderLastName}`,
       //senderPhone: transfert.senderPhone,
       //destination: transfert.destinationLocation,
       //destinationPhone: transfert.receiverPhone,
       //amount: -montantRetire,
       //currency: transfert.currency
    // }).save();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }





});

/******************** SERVER *************************/
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log("🚀 Serveur prêt sur http://localhost:"+PORT));
