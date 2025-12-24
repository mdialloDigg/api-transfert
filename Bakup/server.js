/******************************************************************
 * APP TRANSFERT – AVEC CODE, MONTANT DESTINATAIRE ET AFFICHAGE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

mongoose.connection.on('error', err => console.error('❌ MongoDB connection error:', err));
mongoose.connection.on('connected', ()=>console.log('✅ MongoDB connection OK'));

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: String,
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILITAIRE =================
function generateCode() {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26)); // A-Z
  const number = Math.floor(100 + Math.random() * 900); // 100-999
  return `${letter}${number}`;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:80px}
form{background:#fff;padding:20px;display:inline-block;border-radius:8px}
input,button{padding:10px;margin:5px;width:220px}
button{background:#007bff;color:white;border:none}
</style></head>
<body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
</body></html>
`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    const user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      await new Auth({ username, password: hashed }).save();
      req.session.user = username;
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = username;
    res.redirect('/menu');
  }catch(err){
    console.error('Erreur login:', err);
    res.status(500).send('Erreur serveur: ' + err.message);
  }
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px}
button{width:300px;padding:15px;margin:10px;font-size:16px;border:none;border-radius:6px;color:white}
.send{background:#007bff}
.list{background:#28a745}
.logout{background:#000}
</style></head>
<body>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>
`);
});

// ================= FORMULAIRE =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

app.get('/transferts/new', requireLogin,(req,res)=>{
res.send(`
<html><head><style>
body{font-family:Arial;background:#dde5f0}
form{background:#fff;width:950px;margin:20px auto;padding:20px;border-radius:8px}
h3{background:#007bff;color:white;padding:8px;margin-top:10px}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px}
input,select,button{padding:8px;width:100%}
button{background:#28a745;color:white;border:none;margin-top:10px}
</style></head>
<body>
<form method="post">
<h3>Type de personne</h3>
<select name="userType">
<option>Client</option>
<option>Distributeur</option>
<option>Administrateur</option>
<option>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" placeholder="Prénom">
<input name="senderLastName" placeholder="Nom">
<input name="senderPhone" placeholder="Téléphone">
<select name="originLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" placeholder="Prénom">
<input name="receiverLastName" placeholder="Nom">
<input name="receiverPhone" placeholder="Téléphone">
<select name="destinationLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select>
</div>

<h3>Montants et Code</h3>
<div class="grid">
<input name="amount" type="number" id="amount" placeholder="Montant">
<input name="fees" type="number" id="fees" placeholder="Frais">
<input type="text" id="recoveryAmount" placeholder="Montant à recevoir" readonly>
<input type="text" id="code" placeholder="Code transfert" readonly>
</div>

<button>Enregistrer</button>
</form>
<center><a href="/menu">⬅ Retour menu</a></center>

<script>
function generateCode() {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const number = Math.floor(100 + Math.random() * 900);
  return letter + number;
}

const codeField = document.getElementById('code');
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');

codeField.value = generateCode(); // génération immédiate

function updateRecovery() {
  const amount = parseFloat(amountField.value) || 0;
  const fees = parseFloat(feesField.value) || 0;
  recoveryField.value = amount - fees;
}

amountField.addEventListener('input', updateRecovery);
feesField.addEventListener('input', updateRecovery);
</script>
</body></html>
`);
});

app.post('/transferts/new', requireLogin, async(req,res)=>{
try{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = generateCode(); // génération serveur

  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount,
    retraitHistory: [],
    code
  }).save();

  res.send(`
  <html><head><style>
  body{font-family:Arial;text-align:center;padding-top:50px;background:#dde5f0}
  h2{color:#28a745}
  p{font-size:20px;color:#007bff;font-weight:bold}
  a{margin:10px;display:inline-block;text-decoration:none;padding:10px 20px;background:#007bff;color:white;border-radius:6px}
  </style></head>
  <body>
  <h2>✅ Transfert enregistré</h2>
  <p>Code du transfert : ${code}</p>
  <p>Montant à recevoir : ${recoveryAmount}</p>
  <a href="/transferts/new">➕ Nouveau transfert</a>
  <a href="/transferts/list">📋 Liste des transferts</a>
  </body></html>
  `);
}catch(err){
  console.error('Erreur création transfert:', err);
  res.status(500).send('Erreur serveur: ' + err.message);
}
});

// ================= LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
try{
  const transferts = await Transfert.find().sort({destinationLocation:1}).exec();
  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let totalAmountAll=0, totalFeesAll=0, totalReceivedAll=0;
  let html = `
  <html><head><style>
  body{font-family:Arial;background:#f4f6f9}
  table{width:95%;margin:auto;border-collapse:collapse;background:#fff;margin-bottom:20px}
  th,td{border:1px solid #ccc;padding:6px;font-size:13px;text-align:center}
  th{background:#007bff;color:white}
  .retired{background:#ffe0a3}
  .total{background:#222;color:white;font-weight:bold}
  button{padding:5px 10px;border:none;border-radius:4px;background:#28a745;color:#fff;cursor:pointer}
  select{padding:3px}
  </style></head><body>
  <h2 style="text-align:center">📋 Liste des transferts</h2>
  <a href="/menu">⬅ Menu</a> | <a href="/transferts/pdf">📄 PDF</a>
  <hr>
  `;

  for(let dest in grouped){
    let ta=0,tf=0,tr=0;
    html+=`<h3 style="text-align:center">Destination : ${dest}</h3>
    <table>
  <tr>
  <th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th>
  <th>Montant</th><th>Frais</th><th>Reçu</th><th>Historique</th>
  <th>Destinataire</th><th>Tél</th><th>Code</th><th>Statut</th><th>Action</th>
  </tr>`;
    grouped[dest].forEach(t=>{
      ta+=t.amount; tf+=t.fees; tr+=t.recoveryAmount;
      totalAmountAll+=t.amount; totalFeesAll+=t.fees; totalReceivedAll+=t.recoveryAmount;

      let histHtml = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>') || '-';

      html+=`
  <tr class="${t.retired?'retired':''}">
  <td>${t.userType}</td>
  <td>${t.senderFirstName} ${t.senderLastName}</td>
  <td>${t.senderPhone}</td>
  <td>${t.originLocation}</td>
  <td>${t.amount}</td>
  <td>${t.fees}</td>
  <td>${t.recoveryAmount}</td>
  <td>${histHtml}</td>
  <td>${t.receiverFirstName} ${t.receiverLastName}</td>
  <td>${t.receiverPhone}</td>
  <td>${t.code}</td>
  <td>${t.retired?'Retiré':'Non retiré'}</td>
  <td>${t.retired?'—':`
  <form method="post" action="/transferts/retirer">
  <input type="hidden" name="id" value="${t._id}">
  <select name="mode">
  <option>Espèces</option>
  <option>Orange Money</option>
  <option>Wave</option>
  <option>Produit</option>
  <option>Service</option>
  </select>
  <button>Retirer</button>
  </form>`}</td>
  </tr>`;
    });

    html+=`<tr class="total">
  <td colspan="4">TOTAL ${dest}</td>
  <td>${ta}</td><td>${tf}</td><td>${tr}</td>
  <td colspan="6"></td>
  </tr></table><br>`;
  }

  html+=`<table style="width:95%;margin:auto">
  <tr class="total">
  <td colspan="4">TOTAL GLOBAL</td>
  <td>${totalAmountAll}</td><td>${totalFeesAll}</td><td>${totalReceivedAll}</td>
  <td colspan="6"></td>
  </tr></table>
  </body></html>`;

  res.send(html);
}catch(err){
  console.error('Erreur liste transferts:', err);
  res.status(500).send('Erreur serveur: ' + err.message);
}
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
try{
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,
    recoveryMode:req.body.mode,
    $push: { retraitHistory: { date: new Date(), mode:req.body.mode } }
  });
  res.redirect('/transferts/list');
}catch(err){
  console.error('Erreur retrait:', err);
  res.status(500).send('Erreur serveur: ' + err.message);
}
});

// ================= PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
try{
  const list = await Transfert.find().sort({destinationLocation:1}).exec();
  const doc = new PDFDocument({margin:30, size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
  doc.pipe(res);

  doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'});
  doc.moveDown();

  let groupedPDF = {};
  list.forEach(t=>{ if(!groupedPDF[t.destinationLocation]) groupedPDF[t.destinationLocation]=[]; groupedPDF[t.destinationLocation].push(t); });

  let totalA=0, totalF=0, totalR=0;

  for(let dest in groupedPDF){
    let subA=0, subF=0, subR=0;
    doc.fontSize(14).fillColor('#007bff').text(`Destination: ${dest}`);
    groupedPDF[dest].forEach(t=>{
      subA+=t.amount; subF+=t.fees; subR+=t.recoveryAmount;
      totalA+=t.amount; totalF+=t.fees; totalR+=t.recoveryAmount;

      doc.fontSize(10).fillColor('black')
        .text(`Type: ${t.userType} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
        .text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Destination: ${t.destinationLocation}`)
        .text(`Montant: ${t.amount} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Statut: ${t.retired?'Retiré':'Non retiré'} | Code: ${t.code}`);
      if(t.retraitHistory && t.retraitHistory.length){
        t.retraitHistory.forEach(h=>{
          doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`);
        });
      }
      doc.moveDown(0.5);
    });
    doc.fontSize(12).text(`Sous-total ${dest} → Montant: ${subA} | Frais: ${subF} | Reçu: ${subR}`).moveDown();
  }

  doc.fontSize(14).fillColor('black').text(`TOTAL GLOBAL → Montant: ${totalA} | Frais: ${totalF} | Reçu: ${totalR}`,{align:'center'});
  doc.end();
}catch(err){
  console.error('Erreur PDF:', err);
  res.status(500).send('Erreur serveur: ' + err.message);
}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
