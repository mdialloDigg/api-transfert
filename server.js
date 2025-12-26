/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET AVEC FORMULAIRE AJOUT/MODIF
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');

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

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode() {
  let code; let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= SEED DATA =================
(async function seed() {
  const count = await Transfert.countDocuments();
  if(count === 0){
    console.log('⚡ Seed: Création de transferts de test...');
    const testData = [
      { code:'A101', userType:'Client', senderFirstName:'John', senderLastName:'Doe', senderPhone:'123456', originLocation:'France',
        receiverFirstName:'Jane', receiverLastName:'Smith', receiverPhone:'654321', destinationLocation:'Belgique',
        amount:100, fees:5, recoveryAmount:95, currency:'EUR', retired:false, retraitHistory:[] },
      { code:'B102', userType:'Distributeur', senderFirstName:'Alice', senderLastName:'Martin', senderPhone:'111222', originLocation:'Suisse',
        receiverFirstName:'Bob', receiverLastName:'Brown', receiverPhone:'333444', destinationLocation:'Conakry',
        amount:200, fees:10, recoveryAmount:190, currency:'USD', retired:false, retraitHistory:[] },
    ];
    await Transfert.insertMany(testData);
    console.log('✅ Données de test ajoutées.');
  }
})();

// ================= AUTH / PERMISSIONS =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  let permissions = { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true };
  return permissions;
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
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
  </form></body></html>`);
});
app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = await new Auth({ username, password: hashed }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  const permissions = setPermissions(username);
  req.session.user = { username:user.username, role:user.role, permissions };
  res.redirect('/transferts');
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= LIST TRANSFERTS + FORM =================
app.get('/transferts', requireLogin, async(req,res)=>{
  const optionsCurrency = currencies.map(c=>`<option value="${c}">${c}</option>`).join('');
  const optionsLocation = locations.map(l=>`<option value="${l}">${l}</option>`).join('');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9;}
    table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
    th{background:#007bff;color:white;}
    .retired{background:#fff3b0;}
    button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
    .modify{background:#28a745;}.delete{background:#dc3545;}.retirer{background:#ff9900;}.imprimer{background:#17a2b8;}
    form{background:#fff;padding:15px;border-radius:8px;margin-bottom:20px;}
    @media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>

  <form id="transfertForm">
    <input type="hidden" id="editId">
    <select id="userType">${['Client','Distributeur','Administrateur','Agence de transfert'].map(u=>`<option value="${u}">${u}</option>`).join('')}</select>
    <input id="senderFirstName" placeholder="Prénom expéditeur">
    <input id="senderLastName" placeholder="Nom expéditeur">
    <input id="senderPhone" placeholder="Téléphone expéditeur">
    <input id="originLocation" placeholder="Origine">
    <input id="receiverFirstName" placeholder="Prénom destinataire">
    <input id="receiverLastName" placeholder="Nom destinataire">
    <input id="receiverPhone" placeholder="Téléphone destinataire">
    <select id="destinationLocation">${optionsLocation}</select>
    <input type="number" id="amount" placeholder="Montant">
    <input type="number" id="fees" placeholder="Frais">
    <select id="currency">${optionsCurrency}</select>
    <button type="submit">Ajouter / Modifier</button>
  </form>

  <div>
    <input id="search" placeholder="Recherche...">
    <select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
    <select id="currencyFilter"><option value="">Toutes devises</option>${optionsCurrency}</select>
    <select id="destinationFilter"><option value="">Toutes destinations</option>${optionsLocation}</select>
    <button onclick="loadData()">🔍 Filtrer</button>
    <a href="/logout">🚪 Déconnexion</a>
    <a href="/transferts/excel">📊 Excel</a>
    <a href="/transferts/word">📝 Word</a>
  </div>

  <table>
    <thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody id="tbody"></tbody>
  </table>

  <h3>📊 Totaux par destination et devise</h3>
  <div id="totaux"></div>

<script>
async function loadData(){
  const search = document.getElementById('search').value;
  const status = document.getElementById('status').value;
  const currency = document.getElementById('currencyFilter').value;
  const destination = document.getElementById('destinationFilter').value;
  const res = await fetch('/transferts/data?search='+encodeURIComponent(search)+'&status='+encodeURIComponent(status)+'&currency='+encodeURIComponent(currency)+'&destination='+encodeURIComponent(destination));
  const data = await res.json();
  const tbody = document.getElementById('tbody');
  tbody.innerHTML='';
  const totals={};
  data.forEach(t=>{
    const tr = document.createElement('tr');
    if(t.retired) tr.className='retired';
    tr.innerHTML="<td>"+t.code+"</td><td>"+t.userType+"</td><td>"+t.senderFirstName+" "+t.senderLastName+" ("+t.senderPhone+")</td><td>"+t.originLocation+"</td><td>"+t.receiverFirstName+" "+t.receiverLastName+" ("+t.receiverPhone+")</td><td>"+t.amount+"</td><td>"+t.fees+"</td><td>"+t.recoveryAmount+"</td><td>"+t.currency+"</td><td>"+(t.retired?'Retiré':'Non retiré')+"</td><td><button class='modify' onclick='edit("+JSON.stringify(t)+")'>✏️</button><button class='delete' onclick='remove(\""+t._id+"\")'>❌</button><button class='retirer' onclick='retirer(\""+t._id+"\")'>💰</button><button class='imprimer' onclick='imprimer(\""+t._id+"\")'>🖨</button></td>";
    tbody.appendChild(tr);

    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  });
  const divtot = document.getElementById('totaux');
  divtot.innerHTML='';
  for(let dest in totals){
    for(let curr in totals[dest]){
      divtot.innerHTML+="<p>"+dest+" | "+curr+" : Montant="+totals[dest][curr].amount+", Frais="+totals[dest][curr].fees+", Reçu="+totals[dest][curr].recovery+"</p>";
    }
  }
}

function edit(t){
  document.getElementById('editId').value = t._id;
  document.getElementById('userType').value = t.userType;
  document.getElementById('senderFirstName').value = t.senderFirstName;
  document.getElementById('senderLastName').value = t.senderLastName;
  document.getElementById('senderPhone').value = t.senderPhone;
  document.getElementById('originLocation').value = t.originLocation;
  document.getElementById('receiverFirstName').value = t.receiverFirstName;
  document.getElementById('receiverLastName').value = t.receiverLastName;
  document.getElementById('receiverPhone').value = t.receiverPhone;
  document.getElementById('destinationLocation').value = t.destinationLocation;
  document.getElementById('amount').value = t.amount;
  document.getElementById('fees').value = t.fees;
  document.getElementById('currency').value = t.currency;
}

document.getElementById('transfertForm').onsubmit = async function(e){
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const data = {
    userType: document.getElementById('userType').value,
    senderFirstName: document.getElementById('senderFirstName').value,
    senderLastName: document.getElementById('senderLastName').value,
    senderPhone: document.getElementById('senderPhone').value,
    originLocation: document.getElementById('originLocation').value,
    receiverFirstName: document.getElementById('receiverFirstName').value,
    receiverLastName: document.getElementById('receiverLastName').value,
    receiverPhone: document.getElementById('receiverPhone').value,
    destinationLocation: document.getElementById('destinationLocation').value,
    amount: Number(document.getElementById('amount').value),
    fees: Number(document.getElementById('fees').value),
    currency: document.getElementById('currency').value
  };
  data.recoveryAmount = data.amount - data.fees;

  if(id){
    await fetch('/transferts/edit/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  }else{
    await fetch('/transferts/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  }
  e.target.reset();
  document.getElementById('editId').value='';
  loadData();
}

function remove(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
function retirer(id){var mode=prompt('Mode de retrait: Espèces, Orange Money, Wave');if(mode)fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);}
function imprimer(id){window.open('/transferts/print/'+id,'_blank');}

window.onload=loadData;
</script>
</body></html>`);
});

// ================= AJAX DATA =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  const { search='', status='all', currency='', destination='' } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  transferts = transferts.filter(t=>{
    const s = search.toLowerCase();
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  if(currency) transferts = transferts.filter(t=>t.currency===currency);
  if(destination) transferts = transferts.filter(t=>t.destinationLocation===destination);
  res.json(transferts);
});

// ================= ADD / EDIT =================
app.post('/transferts/add', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  const t = new Transfert({...req.body, code, retired:false, retraitHistory:[]});
  await t.save();
  res.send({ok:true});
});

app.post('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const data = {...req.body};
  data.recoveryAmount = data.amount - data.fees;
  await Transfert.findByIdAndUpdate(req.params.id,data);
  res.send({ok:true});
});

// ================= RETRAIT / DELETE / PRINT / EXCEL / WORD =================
// identiques à la version précédente (réutilise ton code de retrait / delete / print / excel / word)

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
