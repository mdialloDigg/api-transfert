/******************************************************************
 * APP TRANSFERT – VERSION FINALE DASHBOARD MODERNE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const MongoStore = require('connect-mongo');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert',
    collectionName: 'sessions'
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

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
  currency: { type: String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
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
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
</style></head><body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
</body></html>`);
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
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px;}
button{width:280px;padding:15px;margin:12px;font-size:16px;border:none;border-radius:8px;color:white;cursor:pointer;transition:0.3s}
.send{background:#007bff}.send:hover{background:#0056b3}
.list{background:#28a745}.list:hover{background:#1e7e34}
.logout{background:#dc3545}.logout:hover{background:#a71d2a}
</style></head><body>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>`);
});

// ================= LOCATIONS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

// ================= FORMULAIRE NOUVEAU TRANSFERT =================
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
<div><label>Devise</label><select name="currency">
<option>GNF</option><option>EUR</option><option>USD</option><option>XOF</option>
</select></div>
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

app.post('/transferts/new', requireLogin, async(req,res)=>{
  try{
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;
    const code = req.body.code || await generateUniqueCode();
    await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= FORMULAIRE MODIFIER =================
app.get('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
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
<h2>✏️ Modifier Transfert</h2>
<form method="post" action="/transferts/edit/${t._id}">
<h3>Type de personne</h3>
<select name="userType">
<option ${t.userType==='Client'?'selected':''}>Client</option>
<option ${t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<div><label>Prénom</label><input name="senderFirstName" value="${t.senderFirstName}" required></div>
<div><label>Nom</label><input name="senderLastName" value="${t.senderLastName}" required></div>
<div><label>Téléphone</label><input name="senderPhone" value="${t.senderPhone}" required></div>
<div><label>Origine</label><select name="originLocation">
${locations.map(v=>`<option ${v===t.originLocation?'selected':''}>${v}</option>`).join('')}
</select></div>
</div>

<h3>Destinataire</h3>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" value="${t.receiverFirstName}" required></div>
<div><label>Nom</label><input name="receiverLastName" value="${t.receiverLastName}" required></div>
<div><label>Téléphone</label><input name="receiverPhone" value="${t.receiverPhone}" required></div>
<div><label>Destination</label><select name="destinationLocation">
${locations.map(v=>`<option ${v===t.destinationLocation?'selected':''}>${v}</option>`).join('')}
</select></div>
</div>

<h3>Montants & Code</h3>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" value="${t.amount}" required></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" value="${t.fees}" required></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t.recoveryAmount}"></div>
<div><label>Devise</label><select name="currency">
<option ${t.currency==='GNF'?'selected':''}>GNF</option>
<option ${t.currency==='EUR'?'selected':''}>EUR</option>
<option ${t.currency==='USD'?'selected':''}>USD</option>
<option ${t.currency==='XOF'?'selected':''}>XOF</option>
</select></div>
<div><label>Code transfert</label><input type="text" name="code" readonly value="${t.code}"></div>
</div>

<button>Enregistrer</button>
</form>
<center><a href="/transferts/list">⬅ Retour liste</a></center>
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

app.post('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  await Transfert.findByIdAndUpdate(req.params.id,{...req.body, amount, fees, recoveryAmount});
  res.redirect('/transferts/list');
});

// ================= LISTE AVEC RECHERCHE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const search = req.query.phone || '';
  const transferts = await Transfert.find({
    $or: [
      { senderPhone: { $regex: search, $options: 'i' } },
      { receiverPhone: { $regex: search, $options: 'i' } }
    ]
  }).sort({destinationLocation:1});

  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let totalAmountAll=0,totalFeesAll=0,totalReceivedAll=0;
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
table{width:95%;margin:auto;border-collapse:collapse;}
th,td{border:1px solid #ccc;padding:8px;text-align:center;}
th{background:#007bff;color:white;}
button{padding:4px 8px;margin:2px;cursor:pointer;}
button.delete{background:#dc3545;color:white;}
button.print{background:#17a2b8;color:white;}
a{margin:2px;text-decoration:none;}
form{display:inline;}
input.search{padding:6px;width:200px;margin-right:6px;}
</style>
<script>
function confirmDelete(){return confirm('❌ Confirmer suppression?');}
</script>
</head><body>
<h2>Liste des transferts</h2>
<a href="/menu">⬅ Menu</a> | <a href="/transferts/new">➕ Nouveau</a> | <a href="/transferts/pdf">📄 PDF</a>
<form method="get" style="display:inline;">
<input type="text" name="phone" class="search" placeholder="Rechercher par téléphone" value="${search}">
<button type="submit">🔍 Rechercher</button>
</form>
<hr>`;

  for(let dest in grouped){
    let ta=0,tf=0,tr=0;
    html+=`<h3>Destination: ${dest}</h3><table>
<tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Destinataire</th><th>Tél</th>
<th>Code</th><th>Statut</th><th>Actions</th></tr>`;
    grouped[dest].forEach(t=>{
      ta+=t.amount; tf+=t.fees; tr+=t.recoveryAmount;
      totalAmountAll+=t.amount; totalFeesAll+=t.fees; totalReceivedAll+=t.recoveryAmount;

      let histHtml = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>') || '-';

      html+=`<tr class="${t.retired?'retired':''}">
<td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.recoveryAmount}</td>
<td>${t.currency}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.code}</td>
<td>${t.retired?'Retiré':'Non retiré'}<br>${histHtml}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirmDelete();"><button class="delete">❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️ Imprimer</button></a>
${t.retired?'':`<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<select name="mode">
<option>Espèces</option>
<option>Orange Money</option>
<option>Wave</option>
<option>Produit</option>
<option>Service</option>
</select>
<button>Retirer</button>
</form>`}
</td></tr>`;
    });
    html+=`<tr style="font-weight:bold;"><td colspan="4">Total ${dest}</td><td>${ta}</td><td>${tf}</td><td>${tr}</td><td colspan="6"></td></tr></table>`;
  }

  html+=`<h3>Total global</h3><table style="width:50%;margin:auto;">
<tr style="font-weight:bold;"><td>Total Montant</td><td>${totalAmountAll}</td></tr>
<tr style="font-weight:bold;"><td>Total Frais</td><td>${totalFeesAll}</td></tr>
<tr style="font-weight:bold;"><td>Total Reçu</td><td>${totalReceivedAll}</td></tr></table></body></html>`;
  res.send(html);
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

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= IMPRIMER TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;text-align:center;padding:20px;}
.ticket{border:1px dashed #333;padding:15px;width:300px;margin:auto;}
h3{margin:5px 0;}
p{margin:3px 0;font-size:14px;}
button{margin-top:10px;padding:8px 15px;}
</style>
</head>
<body>
<div class="ticket">
<h3>💰 Transfert</h3>
<p>Code: ${t.code}</p>
<p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
<p>Tél: ${t.senderPhone}</p>
<p>Origine: ${t.originLocation}</p>
<p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
<p>Tél: ${t.receiverPhone}</p>
<p>Destination: ${t.destinationLocation}</p>
<p>Montant: ${t.amount}</p>
<p>Frais: ${t.fees}</p>
<p>À recevoir: ${t.recoveryAmount}</p>
<p>Devise: ${t.currency}</p>
<p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
<button onclick="window.print()">🖨️ Imprimer</button>
</div>
</body>
</html>
  `);
});

// ================= PDF =================
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
    list.forEach(t=>{ if(!groupedPDF[t.destinationLocation]) groupedPDF[t.destinationLocation]=[]; groupedPDF[t.destinationLocation].push(t); });

    let totalA=0,totalF=0,totalR=0;

    for(let dest in groupedPDF){
      let subA=0,subF=0,subR=0;
      doc.fontSize(14).fillColor('#007bff').text(`Destination: ${dest}`);
      groupedPDF[dest].forEach(t=>{
        subA+=t.amount; subF+=t.fees; subR+=t.recoveryAmount;
        totalA+=t.amount; totalF+=t.fees; totalR+=t.recoveryAmount;
        doc.fontSize(10).fillColor('black')
        .text(`Type: ${t.userType} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
        .text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Destination: ${t.destinationLocation}`)
        .text(`Montant: ${t.amount} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Devise: ${t.currency} | Statut: ${t.retired?'Retiré':'Non retiré'} | Code: ${t.code}`);
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
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
