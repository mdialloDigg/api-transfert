/******************************************************************
 * APP TRANSFERT – VERSION FINALE DASHBOARD MODERNE
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
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILITAIRE =================
async function generateUniqueCode() {
  let code;
  let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
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
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px;}
button{width:280px;padding:15px;margin:12px;font-size:16px;border:none;border-radius:8px;color:white;cursor:pointer;transition:0.3s}
.send{background:#007bff}
.send:hover{background:#0056b3}
.list{background:#28a745}
.list:hover{background:#1e7e34}
.logout{background:#dc3545}
.logout:hover{background:#a71d2a}
</style></head>
<body>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>
`);
});

// ================= LOCATIONS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/new', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
.container{max-width:900px;margin:40px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{color:#2c7be5;text-align:center;margin-bottom:30px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:20px;}
label{display:block;margin-bottom:6px;font-weight:bold;color:#555;}
input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
input[readonly]{background:#e9ecef;}
button{width:100%;padding:15px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#218838;}
a{display:inline-block;margin-top:20px;color:#2c7be5;text-decoration:none;font-weight:bold;}
a:hover{text-decoration:underline;}
</style>
</head>
<body>
<div class="container">
<h2>➕ Nouveau Transfert</h2>
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
<div><label>Prénom</label><input name="senderFirstName" required></div>
<div><label>Nom</label><input name="senderLastName" required></div>
<div><label>Téléphone</label><input name="senderPhone" required></div>
<div><label>Origine</label><select name="originLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select></div>
</div>

<h3>Destinataire</h3>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" required></div>
<div><label>Nom</label><input name="receiverLastName" required></div>
<div><label>Téléphone</label><input name="receiverPhone" required></div>
<div><label>Destination</label><select name="destinationLocation">
${locations.map(v=>`<option>${v}</option>`).join('')}
</select></div>
</div>

<h3>Montants & Code</h3>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" required></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly></div>
<div><label>Code transfert</label><input type="text" id="code" name="code" readonly value="${code}"></div>
</div>

<button>Enregistrer</button>
</form>

<center><a href="/menu">⬅ Retour menu</a></center>
</div>

<script>
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');

function updateRecovery() {
  const amount = parseFloat(amountField.value) || 0;
  const fees = parseFloat(feesField.value) || 0;
  recoveryField.value = amount - fees;
}
amountField.addEventListener('input', updateRecovery);
feesField.addEventListener('input', updateRecovery);
updateRecovery();
</script>
</body>
</html>
`);
});

// ================= ENREGISTRER TRANSFERT =================
app.post('/transferts/new', requireLogin, async(req,res)=>{
try{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  let code = req.body.code || await generateUniqueCode();

  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount,
    retraitHistory: [],
    code
  }).save();

  res.send(`
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;text-align:center;padding-top:50px;background:#dde5f0}
  h2{color:#28a745}
  p{font-size:20px;color:#007bff;font-weight:bold;margin:10px 0;}
  a{margin:10px;display:inline-block;text-decoration:none;padding:12px 25px;background:#007bff;color:white;border-radius:8px;}
  a:hover{background:#0056b3;}
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

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
try{
  const transferts = await Transfert.find().sort({destinationLocation:1}).exec();
  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let totalAmountAll=0, totalFeesAll=0, totalReceivedAll=0;
  let html = `
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9;margin:0;padding:0;}
h2{text-align:center;color:#2c7be5;margin:20px 0;}
table{width:95%;margin:auto;border-collapse:collapse;background:#fff;margin-bottom:30px;border-radius:8px;overflow:hidden;}
th,td{border:1px solid #ccc;padding:10px;font-size:13px;text-align:center;}
th{background:#007bff;color:white;}
tr:hover{background:#e8f0fe;}
.retired{background:#ffe0a3;}
.total{background:#222;color:white;font-weight:bold;}
form{margin:0;display:inline-block;}
button{padding:5px 10px;border:none;border-radius:4px;background:#28a745;color:#fff;cursor:pointer;margin:2px;}
button.print{background:#17a2b8;}
button.delete{background:#dc3545;}
select{padding:4px;}
a{display:inline-block;margin:2px;text-decoration:none;color:#2c7be5;font-weight:bold;}
a:hover{text-decoration:underline;}
</style>
</head>
<body>
<h2>📋 Liste des transferts</h2>
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
<form method="post" action="/transferts/retirer" style="display:inline-block">
<input type="hidden" name="id" value="${t._id}">
<select name="mode">
<option>Espèces</option>
<option>Orange Money</option>
<option>Wave</option>
<option>Produit</option>
<option>Service</option>
</select>
<button>Retirer</button>
</form>
<a href="/transferts/edit/${t._id}"><button>Modifier</button></a>
<form method="post" action="/transferts/delete/${t._id}" style="display:inline-block">
<button class="delete">Supprimer</button>
</form>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">Imprimer</button></a>
`}</td>
</tr>`;
  });

  html+=`<tr class="total">
<td colspan="4">TOTAL ${dest}</td>
<td>${ta}</td><td>${tf}</td><td>${tr}</td>
<td colspan="6"></td>
</tr></table>`;
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

// ================= MODIFIER TRANSFERT =================
app.get('/transferts/edit/:id', requireLogin, async (req, res) => {
  try {
    const t = await Transfert.findById(req.params.id).exec();
    if (!t) return res.send('Transfert introuvable');

    res.send(`
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8;}
.container{max-width:900px;margin:40px auto;background:#fff;padding:30px;border-radius:12px;}
label{display:block;margin:6px 0;font-weight:bold;}
input,select{width:100%;padding:10px;margin-bottom:12px;border-radius:6px;border:1px solid #ccc;}
button{padding:12px;background:#2eb85c;color:white;border:none;border-radius:6px;cursor:pointer;}
button:hover{background:#218838;}
a{display:inline-block;margin-top:15px;color:#007bff;text-decoration:none;}
a:hover{text-decoration:underline;}
</style>
</head>
<body>
<div class="container">
<h2>✏ Modifier Transfert</h2>
<form method="post">
<label>Type de personne</label>
<select name="userType">
<option ${t.userType==='Client'?'selected':''}>Client</option>
<option ${t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>

<label>Prénom expéditeur</label><input name="senderFirstName" value="${t.senderFirstName}" required>
<label>Nom expéditeur</label><input name="senderLastName" value="${t.senderLastName}" required>
<label>Téléphone expéditeur</label><input name="senderPhone" value="${t.senderPhone}" required>
<label>Origine</label>
<select name="originLocation">
${locations.map(v=>`<option ${v===t.originLocation?'selected':''}>${v}</option>`).join('')}
</select>

<label>Prénom destinataire</label><input name="receiverFirstName" value="${t.receiverFirstName}" required>
<label>Nom destinataire</label><input name="receiverLastName" value="${t.receiverLastName}" required>
<label>Téléphone destinataire</label><input name="receiverPhone" value="${t.receiverPhone}" required>
<label>Destination</label>
<select name="destinationLocation">
${locations.map(v=>`<option ${v===t.destinationLocation?'selected':''}>${v}</option>`).join('')}
</select>

<label>Montant</label><input type="number" name="amount" value="${t.amount}" required>
<label>Frais</label><input type="number" name="fees" value="${t.fees}" required>
<label>Code transfert</label><input name="code" value="${t.code}" readonly>

<button>Enregistrer les modifications</button>
</form>
<a href="/transferts/list">⬅ Retour à la liste</a>
</div>
</body>
</html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

app.post('/transferts/edit/:id', requireLogin, async (req, res) => {
  try {
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;

    await Transfert.findByIdAndUpdate(req.params.id, {
      ...req.body,
      amount,
      fees,
      recoveryAmount
    });

    res.redirect('/transferts/list');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// ================= SUPPRIMER TRANSFERT =================
app.post('/transferts/delete/:id', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndDelete(req.params.id);
    res.redirect('/transferts/list');
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// ================= IMPRIMER TRANSFERT =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  try{
    const t = await Transfert.findById(req.params.id).exec();
    if(!t) return res.send('Transfert introuvable');

    const doc = new PDFDocument({margin:30, size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename=transfert_${t.code}.pdf`);
    doc.pipe(res);

    doc.fontSize(18).text(`TRANSFERT ${t.code}`,{align:'center'});
    doc.moveDown();
    doc.fontSize(12).text(`Type: ${t.userType}`);
    doc.text(`Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`);
    doc.text(`Origine: ${t.originLocation}`);
    doc.text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`);
    doc.text(`Destination: ${t.destinationLocation}`);
    doc.text(`Montant: ${t.amount} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount}`);
    doc.text(`Statut: ${t.retired?'Retiré':'Non retiré'}`);
    if(t.retraitHistory.length){
      t.retraitHistory.forEach(h=>{
        doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`);
      });
    }
    doc.end();
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur');
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
