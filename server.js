/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

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

// ================= UTILITAIRE =================
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

// ================= AUTH =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOCATIONS =================
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
</form></body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    let user = await Auth.findOne({username}).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      user = await new Auth({username,password:hashed,role:'admin'}).save();
      req.session.user = { username, role:'admin' };
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = { username:user.username, role:user.role };
    res.redirect('/menu');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
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
<a href="/transferts/form"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Dashboard</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</body></html>`);
});

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;background:#f4f6f9;margin:0;padding:20px;}
.container{max-width:900px;margin:20px auto 40px;background:white;padding:25px 30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
h2{color:#2c7be5;text-align:center;margin-bottom:20px;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin-bottom:20px;}
label{display:block;margin-bottom:6px;font-weight:bold;color:#555;}
input,select{width:100%;padding:12px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
input[readonly]{background:#e9ecef;}
button.save{width:100%;padding:15px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;transition:0.3s;}
button.save:hover{background:#218838;}
a.back{display:inline-block;margin-top:20px;color:#2c7be5;text-decoration:none;font-weight:bold;}
a.back:hover{text-decoration:underline;}
</style></head><body>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">
<h3>Type de personne</h3>
<select name="userType">
<option ${t&&t.userType==='Client'?'selected':''}>Client</option>
<option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
<option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
<option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
</select>
<h3>Expéditeur</h3><div class="grid">
<div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
<div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
<div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
<div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
</div>
<h3>Destinataire</h3><div class="grid">
<div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
<div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
<div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
<div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
</div>
<h3>Montants & Devise & Code</h3><div class="grid">
<div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
<div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
<div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
<div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
<div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
</div>
<button class="save">${t?'Enregistrer Modifications':'Enregistrer'}</button>
</form>
<a href="/transferts/list" class="back">⬅ Retour liste</a>
</div>
<script>
const amountField = document.getElementById('amount');
const feesField = document.getElementById('fees');
const recoveryField = document.getElementById('recoveryAmount');
function updateRecovery(){const a=parseFloat(amountField.value)||0;const f=parseFloat(feesField.value)||0;recoveryField.value=a-f;}
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();
</script>
</body></html>`);
});

// ================= POST FORMULAIRE =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;
    const code = req.body.code || await generateUniqueCode();
    let existing = await Transfert.findOne({code});
    if(existing){
      await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
    }else{
      await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
    }
    res.redirect(`/transferts/list?searchCode=${code}`);
  }catch(err){console.error(err);res.status(500).send(err.message);}
});

// ================= LISTE TABLEAU MODERNE =================
app.get(['/transferts/list','/transferts/list/'], requireLogin, async(req,res)=>{
  try{
    let { searchPhone, searchCode, searchName, destination, status, page } = req.query;
    const perPage = 10;
    page = parseInt(page)||1;

    let query = {};
    if(searchPhone) query.$or=[{senderPhone:new RegExp(searchPhone,'i')},{receiverPhone:new RegExp(searchPhone,'i')}];
    if(searchCode) query.code = new RegExp(searchCode,'i');
    if(searchName) query.$or=query.$or?[...query.$or,{receiverFirstName:new RegExp(searchName,'i')},{receiverLastName:new RegExp(searchName,'i')}]:[{receiverFirstName:new RegExp(searchName,'i')},{receiverLastName:new RegExp(searchName,'i')}];
    if(destination && destination!=='all') query.destinationLocation = destination;
    if(status==='retired') query.retired=true;
    if(status==='not') query.retired=false;

    const totalCount = await Transfert.countDocuments(query);
    const transferts = await Transfert.find(query).sort({destinationLocation:1, createdAt:-1}).skip((page-1)*perPage).limit(perPage);

    // Totaux
    const totals = await Transfert.aggregate([
      { $match: query },
      { $group: { _id:null, totalAmount:{$sum:'$amount'}, totalFees:{$sum:'$fees'}, totalRecovery:{$sum:'$recoveryAmount'} } }
    ]);
    const totalAmount = totals[0]?.totalAmount||0;
    const totalFees = totals[0]?.totalFees||0;
    const totalRecovery = totals[0]?.totalRecovery||0;

    const destinations = await Transfert.distinct('destinationLocation');

    // HTML tableau
    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
.table-container{overflow-x:auto;background:white;padding:15px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);}
table{width:100%;border-collapse:collapse;}
th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left;font-size:14px;}
th{background:#007bff;color:white;white-space:nowrap;}
tr:hover{background:#f1f1f1;}
a.button{padding:5px 10px;background:#28a745;color:white;border-radius:6px;text-decoration:none;margin-right:5px;font-size:13px;}
a.delete{background:#dc3545;}
form.inline{display:inline;}
div.top{margin-bottom:15px;}
select,input{padding:6px;margin-right:5px;border-radius:6px;border:1px solid #ccc;}
.pagination{margin-top:15px;}
.pagination a{padding:5px 10px;border:1px solid #ccc;margin-right:3px;text-decoration:none;color:#007bff;}
.pagination a.active{background:#007bff;color:white;}
</style></head><body>
<h2>📋 Liste des transferts</h2>
<div class="top">
<a href="/menu">⬅ Menu</a>
<a href="/transferts/form">➕ Nouveau</a>
<a href="/transferts/pdf">📄 PDF</a>
<a href="/transferts/excel">📊 Excel</a>
<form method="get" style="display:inline;">
<input name="searchPhone" placeholder="Téléphone" value="${searchPhone||''}">
<input name="searchCode" placeholder="Code" value="${searchCode||''}">
<input name="searchName" placeholder="Nom destinataire" value="${searchName||''}">
<select name="destination">
<option value="all">Toutes destinations</option>
${destinations.map(d=>`<option value="${d}" ${d===destination?'selected':''}>${d}</option>`).join('')}
</select>
<select name="status">
<option value="all">Tous</option>
<option value="retired" ${status==='retired'?'selected':''}>Retiré</option>
<option value="not" ${status==='not'?'selected':''}>Non retiré</option>
</select>
<button type="submit">🔍 Rechercher</button>
</form>
</div>
<div class="table-container">
<table>
<tr>
<th>Code</th><th>Expéditeur</th><th>Tél</th><th>Origine</th><th>Destinataire</th><th>Tél</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Statut & Historique</th><th>Actions</th>
</tr>`;
transferts.forEach(t=>{
  let hist = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>')||'-';
  html+=`<tr>
<td>${t.code}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.destinationLocation}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.recoveryAmount}</td>
<td>${t.retired?'Retiré':'Non retiré'}<br>${hist}</td>
<td>
<a href="/transferts/form?code=${t.code}" class="button">✏️ Modifier</a>
<a href="/transferts/delete/${t._id}" class="button delete" onclick="return confirm('❌ Confirmer suppression?')">❌ Supprimer</a>
${!t.retired?`<form class="inline" method="post" action="/transferts/retirer"><input type="hidden" name="id" value="${t._id}"><select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select><button type="submit" class="button">Retirer</button></form>`:''}
</td>
</tr>`;
});
html+=`</table>
<p>Total Montant: ${totalAmount} | Total Frais: ${totalFees} | Total Reçu: ${totalRecovery}</p>
<div class="pagination">`;
for(let i=1;i<=Math.ceil(totalCount/perPage);i++){
  html+=`<a href="?page=${i}" class="${i===page?'active':''}">${i}</a>`;
}
html+=`</div></div></body></html>`;
res.send(html);
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const t = await Transfert.findById(req.body.id);
    if(t && !t.retired){
      t.retired = true;
      t.retraitHistory.push({ date: new Date(), mode: req.body.mode });
      await t.save();
    }
    res.redirect('/transferts/list');
  }catch(err){res.status(500).send(err.message);}
});

// ================= DELETE =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{
  req.session.destroy();
  res.redirect('/login');
});

// ================= SERVER =================
const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Server running on port ${PORT}`));
