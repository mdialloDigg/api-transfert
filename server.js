/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLETE TOUT-EN-UN
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
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
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

// ================= AUTH MIDDLEWARE =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOCATIONS & DEVISES =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

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
<a href="/transferts/form"><button class="send">➕ Nouveau Transfert</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>`);
});

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({ code:req.query.code }) : null;
  const code = t ? t.code : await generateUniqueCode();
  const amount = t ? t.amount : 0;
  const fees = t ? t.fees : 0;
  const recoveryAmount = amount - fees;

  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8;padding:20px;}
.container{max-width:900px;margin:auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{text-align:center;color:#2c7be5;margin-bottom:25px;}
label{display:block;margin:8px 0 4px;font-weight:bold;color:#555;}
input,select,button{width:100%;padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;margin-bottom:10px;}
input[readonly]{background:#e9ecef;}
button{width:100%;padding:15px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;margin-top:10px;}
button:hover{background:#218838;}
a{display:block;margin-top:15px;text-align:center;color:#2c7be5;text-decoration:none;font-weight:bold;}
a:hover{text-decoration:underline;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;}
table{width:100%;border-collapse:collapse;margin-top:20px;}
th,td{padding:10px;border:1px solid #ddd;text-align:center;font-size:14px;}
th{background:#007bff;color:white;}
tr:nth-child(even){background:#f9f9f9;}
tr.retired td{background:#f8d7da;color:#721c24;}
.actions button{margin:2px;padding:6px 10px;font-size:12px;border-radius:6px;}
button.delete{background:#dc3545;color:white;}
button.print{background:#17a2b8;color:white;}
select, input{font-size:14px;}
@media(max-width:600px){
  .grid{grid-template-columns:1fr;}
  table, th, td{font-size:12px;}
  button{font-size:14px;padding:12px;}
}
</style></head>
<body>
<div class="container">
<h2>${t ? '✏️ Modifier Transfert' : '➕ Nouveau Transfert'}</h2>
<form method="post" action="/transferts/save">
<h3>Type de personne</h3>
<select name="userType">
<option ${t&&t.userType==='Client'?'selected':''}>Client</option>
<option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>

<h3>Expéditeur</h3>
<div class="grid">
<div><label>Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required></div>
<div><label>Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required></div>
<div><label>Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required></div>
<div><label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
</div>

<h3>Destinataire</h3>
<div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required></div>
<div><label>Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required></div>
<div><label>Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required></div>
<div><label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
</div>

<h3>Montants & Devise</h3>
<div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" value="${amount}" required></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" value="${fees}" required></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${recoveryAmount}"></div>
<div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
</div>

<input type="text" name="code" readonly value="${code}">
<button>Enregistrer</button>
</form>
<a href="/transferts/list">⬅ Retour liste</a>
</div>

<script>
const amountField=document.getElementById('amount');
const feesField=document.getElementById('fees');
const recoveryField=document.getElementById('recoveryAmount');
function updateRecovery(){const amount=parseFloat(amountField.value)||0;const fees=parseFloat(feesField.value)||0;recoveryField.value=amount-fees;}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();
</script>
</body></html>`);
});

// ================= SAVE / UPDATE =================
app.post('/transferts/save', requireLogin, async(req,res)=>{
  try{
    const { userType, senderFirstName, senderLastName, senderPhone,
      originLocation, receiverFirstName, receiverLastName, receiverPhone,
      destinationLocation, amount, fees, currency, code } = req.body;
    const parsedAmount = parseFloat(amount)||0;
    const parsedFees = parseFloat(fees)||0;
    const recoveryAmount = parsedAmount - parsedFees;

    let t = await Transfert.findOne({ code }).exec();
    if(t){
      Object.assign(t,{userType,senderFirstName,senderLastName,senderPhone,
        originLocation,receiverFirstName,receiverLastName,receiverPhone,
        destinationLocation,amount:parsedAmount,fees:parsedFees,recoveryAmount,currency});
      await t.save();
    } else {
      await new Transfert({userType,senderFirstName,senderLastName,senderPhone,
        originLocation,receiverFirstName,receiverLastName,receiverPhone,
        destinationLocation,amount:parsedAmount,fees:parsedFees,recoveryAmount,currency,code,retraitHistory:[]}).save();
    }
    res.redirect('/transferts/list');
  }catch(err){console.error(err);res.status(500).send(err.message);}
});

// ================= LISTE AVEC ACTIONS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1});
  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8;padding:20px;}
table{width:100%;border-collapse:collapse;margin-top:20px;}
th,td{padding:10px;border:1px solid #ddd;text-align:center;font-size:14px;}
th{background:#007bff;color:white;}
tr:nth-child(even){background:#f9f9f9;}
tr.retired td{background:#f8d7da;color:#721c24;}
.actions button{margin:2px;padding:6px 10px;font-size:12px;border-radius:6px;}
button.delete{background:#dc3545;color:white;}
button.print{background:#17a2b8;color:white;}
@media(max-width:600px){table, th, td{font-size:12px;}}
</style><script>function confirmDelete(){return confirm('❌ Confirmer suppression?');}</script></head><body>
<h2>Liste des transferts</h2><a href="/menu">⬅ Menu</a> | <a href="/transferts/form">➕ Nouveau</a> | <a href="/transferts/pdf">📄 PDF</a><hr>`;

  for(let dest in grouped){
    html+=`<h3>Destination: ${dest}</h3><table>
<tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Destinataire</th><th>Tél</th>
<th>Code</th><th>Statut</th><th>Actions</th></tr>`;
    grouped[dest].forEach(t=>{
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
<td class="actions">
<a href="/transferts/form?code=${t.code}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirmDelete();"><button class="delete">❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️ Imprimer</button></a>
${t.retired?'':`<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select>
<button>Retirer</button></form>`}
</td></tr>`;
    });
    html+='</table>';
  }
  html+='</body></html>';
  res.send(html);
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      $push: { retraitHistory: { date: new Date(), mode:req.body.mode } }
    });
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= IMPRIMER TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body><div style="width:300px;margin:auto;border:1px dashed #333;padding:15px;text-align:center;">
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
<button onclick="window.print()">🖨️ Imprimer</button></div></body></html>`);
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

    for(let dest in groupedPDF){
      doc.fontSize(14).fillColor('#007bff').text(`Destination: ${dest}`);
      groupedPDF[dest].forEach(t=>{
        doc.fontSize(10).fillColor('black')
          .text(`Code:${t.code} | ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | ${t.retired?'Retiré':'Non retiré'}`);
      });
      doc.moveDown();
    }
    doc.end();
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
