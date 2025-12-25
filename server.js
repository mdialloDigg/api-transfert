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

// ================= MODELS =================
const Transfert = require('./models/Transfert');
const Auth = require('./models/Auth');

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

// ================= LOCATIONS & DEVISES =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= MENU / DASHBOARD =================
app.get('/menu', requireLogin, async(req,res)=>{
  try {
    const transferts = await Transfert.find().sort({destinationLocation:1});
    const codeAuto = await generateUniqueCode();
    
    let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:Arial;background:#eef2f7;padding:20px;}
    button{padding:10px 15px;margin:5px;border:none;border-radius:8px;cursor:pointer;}
    .add{background:#007bff;color:white;}
    .list{background:#28a745;color:white;}
    .logout{background:#dc3545;color:white;}
    </style></head><body>
    <h2>📲 Gestion des transferts</h2>
    <a href="/transferts/form"><button class="add">➕ Nouveau Transfert</button></a>
    <a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a>
    <a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
    </body></html>`;
    res.send(html);
  } catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  res.send(`
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f0f4f8;padding:20px;}
.container{background:white;padding:20px;border-radius:10px;max-width:600px;margin:auto;}
input,select,button{width:100%;padding:10px;margin:5px 0;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;font-weight:bold;cursor:pointer;}
button:hover{background:#0056b3;}
</style></head>
<body>
<div class="container">
<h2>➕ Nouveau Transfert</h2>
<form method="post" action="/transferts/save">
<label>Type de personne</label>
<select name="userType">
<option>Client</option>
<option>Distributeur</option>
<option>Administrateur</option>
<option>Agence de transfert</option>
</select>
<label>Prénom Expéditeur</label><input name="senderFirstName" required>
<label>Nom Expéditeur</label><input name="senderLastName" required>
<label>Téléphone Expéditeur</label><input name="senderPhone" required>
<label>Origine</label>
<select name="originLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select>

<label>Prénom Destinataire</label><input name="receiverFirstName" required>
<label>Nom Destinataire</label><input name="receiverLastName" required>
<label>Téléphone Destinataire</label><input name="receiverPhone" required>
<label>Destination</label>
<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select>

<label>Montant</label><input type="number" name="amount" required>
<label>Frais</label><input type="number" name="fees" required>
<label>Devise</label>
<select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>
<label>Code transfert</label><input name="code" readonly value="${code}">
<button>Enregistrer</button>
</form>
<a href="/menu">⬅ Retour menu</a>
</div>
</body>
</html>
  `);
});

// ================= ENREGISTRER / MODIFIER =================
app.post('/transferts/save', requireLogin, async (req, res) => {
  try {
    const {
      userType, senderFirstName, senderLastName, senderPhone,
      originLocation, receiverFirstName, receiverLastName, receiverPhone,
      destinationLocation, amount, fees, currency, code
    } = req.body;

    const parsedAmount = parseFloat(amount) || 0;
    const parsedFees = parseFloat(fees) || 0;
    const recoveryAmount = parsedAmount - parsedFees;

    let transfert = await Transfert.findOne({ code }).exec();

    if (transfert) {
      Object.assign(transfert, {userType, senderFirstName, senderLastName, senderPhone, originLocation, receiverFirstName, receiverLastName, receiverPhone, destinationLocation, amount:parsedAmount, fees:parsedFees, recoveryAmount, currency});
      await transfert.save();
    } else {
      const newCode = code || await generateUniqueCode();
      await new Transfert({userType, senderFirstName, senderLastName, senderPhone, originLocation, receiverFirstName, receiverLastName, receiverPhone, destinationLocation, amount:parsedAmount, fees:parsedFees, recoveryAmount, currency, code:newCode, retraitHistory:[]}).save();
    }

    res.redirect('/transferts/list');
  } catch (err) { console.error(err); res.status(500).send(err.message);}
});

// ================= LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1});
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  table{width:95%;margin:auto;border-collapse:collapse;}
  th,td{border:1px solid #ccc;padding:6px;text-align:center;}
  th{background:#007bff;color:white;}
  button{padding:4px 8px;margin:2px;cursor:pointer;}
  button.delete{background:#dc3545;color:white;}
  button.print{background:#17a2b8;color:white;}
  form{display:inline;}
  </style></head><body>
  <h2>Liste des transferts</h2><a href="/menu">⬅ Menu</a> | <a href="/transferts/form">➕ Nouveau</a> | <a href="/transferts/pdf">📄 PDF</a><hr>
  <table><tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Destinataire</th><th>Tél</th><th>Code</th><th>Statut</th><th>Actions</th></tr>`;
  
  transferts.forEach(t=>{
    let histHtml = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>')||'-';
    html+=`<tr>
<td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.amount} ${t.currency}</td>
<td>${t.fees} ${t.currency}</td>
<td>${t.recoveryAmount} ${t.currency}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.code}</td>
<td>${t.retired?'Retiré':'Non retiré'}<br>${histHtml}</td>
<td>
<a href="/transferts/form?code=${t.code}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer suppression?')"><button class="delete">❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️ Imprimer</button></a>
<form method="post" action="/transferts/retirer">${t.retired?'':`<input type="hidden" name="id" value="${t._id}"><select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select><button>Retirer</button>`}</form>
</td></tr>`;
  });

  html+=`</table></body></html>`;
  res.send(html);
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const { id, mode } = req.body;
    const t = await Transfert.findById(id);
    if(!t) return res.status(404).send('Transfert introuvable');
    t.retired = true;
    t.recoveryMode = mode;
    t.retraitHistory.push({date:new Date(), mode});
    await t.save();
    res.redirect('/transferts/list');
  }catch(err){console.error(err); res.status(500).send(err.message);}
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  try{ await Transfert.findByIdAndDelete(req.params.id); res.redirect('/transferts/list');}
  catch(err){console.error(err); res.status(500).send(err.message);}
});

// ================= TICKET PDF INDIVIDUEL =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;text-align:center;padding:20px;} .ticket{border:1px dashed #333;padding:15px;width:300px;margin:auto;} button{margin-top:10px;padding:8px 15px;}</style></head><body><div class="ticket"><h3>💰 Transfert</h3><p>Code: ${t.code}</p><p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p><p>Tél: ${t.senderPhone}</p><p>Origine: ${t.originLocation}</p><p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p><p>Tél: ${t.receiverPhone}</p><p>Destination: ${t.destinationLocation}</p><p>Montant: ${t.amount} ${t.currency}</p><p>Frais: ${t.fees} ${t.currency}</p><p>À recevoir: ${t.recoveryAmount} ${t.currency}</p><p>Statut: ${t.retired?'Retiré':'Non retiré'}</p><button onclick="window.print()">🖨️ Imprimer</button></div></body></html>`);
});

// ================= PDF GLOBAL =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  try{
    const list = await Transfert.find().sort({destinationLocation:1});
    const doc = new PDFDocument({margin:30, size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'});
    doc.moveDown();

    let groupedPDF = {};
    list.forEach(t=>{if(!groupedPDF[t.destinationLocation]) groupedPDF[t.destinationLocation]=[]; groupedPDF[t.destinationLocation].push(t);});

    let totalA=0,totalF=0,totalR=0;

    for(let dest in groupedPDF){
      let subA=0,subF=0,subR=0;
      doc.fontSize(14).fillColor('#007bff').text(`Destination: ${dest}`);
      groupedPDF[dest].forEach(t=>{
        subA+=t.amount; subF+=t.fees; subR+=t.recoveryAmount;
        totalA+=t.amount; totalF+=t.fees; totalR+=t.recoveryAmount;
        doc.fontSize(10).fillColor('black')
        .text(`Type: ${t.userType} | Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
        .text(`Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} ${t.currency} | Reçu: ${t.recoveryAmount} ${t.currency} | Statut: ${t.retired?'Retiré':'Non retiré'} | Code: ${t.code}`);
        if(t.retraitHistory && t.retraitHistory.length){t.retraitHistory.forEach(h=>{doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`);});}
        doc.moveDown(0.5);
      });
      doc.fontSize(12).text(`Sous-total ${dest} → Montant: ${subA} | Frais: ${subF} | Reçu: ${subR}`).moveDown();
    }
    doc.fontSize(14).fillColor('black').text(`TOTAL GLOBAL → Montant: ${totalA} | Frais: ${totalF} | Reçu: ${totalR}`,{align:'center'});
    doc.end();
  }catch(err){console.error(err); res.status(500).send(err.message);}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
