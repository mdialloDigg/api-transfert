/******************************************************************
 * APP TRANSFERT – DASHBOARD FINAL COMPLET
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
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
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

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
input,button,select{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
</style></head><body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<select name="role">
<option value="agent">Agent</option>
<option value="admin">Administrateur</option>
</select><br>
<button>Connexion</button>
</form></body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password, role } = req.body;
    const user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      await new Auth({ username, password: hashed, role }).save();
      req.session.user = { username, role };
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = { username, role: user.role };
    res.redirect('/menu');
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur: '+err.message);}
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

// ================= LOCATIONS & CURRENCIES =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
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

<button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
</form>
<center><a href="/menu">⬅ Retour menu</a></center>
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
    // Rediriger vers liste avec préremplissage
    const query = `?searchCode=${code}`;
    res.redirect('/transferts/list'+query);
  }catch(err){console.error(err);res.status(500).send(err.message);}
});

// ================= LA LISTE FINALE + TOUT =================
app.get('/transferts/list', requireLogin, async (req,res) => {
  try{
    const page = parseInt(req.query.page) || 1;
    const perPage = 10;
    const transferts = await Transfert.find().sort({ destinationLocation: 1, createdAt:-1 });
    
    // Filtrage
    let filtered = transferts;
    const { searchPhone, searchCode, searchName, destination, status } = req.query;
    if(searchPhone) filtered = filtered.filter(t => t.senderPhone.includes(searchPhone) || t.receiverPhone.includes(searchPhone));
    if(searchCode) filtered = filtered.filter(t => t.code.includes(searchCode));
    if(searchName) filtered = filtered.filter(t => t.receiverFirstName.toLowerCase().includes(searchName.toLowerCase()) || t.receiverLastName.toLowerCase().includes(searchName.toLowerCase()));
    if(destination && destination!=='all') filtered = filtered.filter(t => t.destinationLocation === destination);
    if(status==='retired') filtered = filtered.filter(t => t.retired);
    if(status==='not') filtered = filtered.filter(t => !t.retired);
    
    const totalAmount = filtered.reduce((a,b)=>a+b.amount,0);
    const totalFees = filtered.reduce((a,b)=>a+b.fees,0);
    const totalReceived = filtered.reduce((a,b)=>a+b.recoveryAmount,0);
    
    const destinations = [...new Set(filtered.map(t=>t.destinationLocation))];
    
    // Pagination
    const paginated = filtered.slice((page-1)*perPage, page*perPage);
    const totalPages = Math.ceil(filtered.length/perPage);
    
    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
h1{color:#2c7be5;text-align:center;margin-bottom:20px;}
.container{max-width:1200px;margin:auto;}
.stats{display:flex;flex-wrap:wrap;gap:15px;justify-content:center;margin-bottom:25px;}
.stat-card{flex:1 1 180px;background:white;border-radius:12px;padding:15px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;}
.stat-card h3{margin:5px 0;color:#007bff;}
.stat-card p{margin:5px 0;font-size:16px;color:#495057;font-weight:bold;}
.search-bar{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-bottom:20px;}
input, select{padding:8px;border-radius:6px;border:1px solid #ccc;}
.card{background:white;border-radius:12px;padding:15px;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-bottom:20px;}
.card h3{margin:0 0 10px 0;color:#007bff;}
.card p{margin:4px 0;font-size:14px;color:#495057;}
.card .status{font-weight:bold;padding:3px 6px;border-radius:6px;color:white;display:inline-block;margin-top:6px;}
.status.retiré{background:#dc3545;}
.status.non{background:#28a745;}
.card .actions{margin-top:10px;display:flex;flex-wrap:wrap;gap:5px;}
button{padding:6px 10px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:13px;}
button.modify{background:#28a745;}
button.delete{background:#dc3545;}
button.print{background:#17a2b8;}
button.retire{background:#007bff;}
a{text-decoration:none;color:#007bff;}
a:hover{text-decoration:underline;}
.pagination{margin-top:20px;text-align:center;}
.pagination a{margin:0 5px;text-decoration:none;color:#007bff;}
</style></head><body>
<div class="container">
<h1>📋 Liste des transferts</h1>

<div class="stats">
<div class="stat-card"><h3>Total Montants</h3><p>${totalAmount}</p></div>
<div class="stat-card"><h3>Total Frais</h3><p>${totalFees}</p></div>
<div class="stat-card"><h3>Total Reçu</h3><p>${totalReceived}</p></div>
</div>

<div class="search-bar">
<form method="get" action="/transferts/list">
<input type="text" name="searchPhone" placeholder="Téléphone" value="${searchPhone||''}">
<input type="text" name="searchCode" placeholder="Code" value="${searchCode||''}">
<input type="text" name="searchName" placeholder="Nom destinataire" value="${searchName||''}">
<select name="destination"><option value="all">Toutes destinations</option>${destinations.map(d=>`<option ${destination===d?'selected':''}>${d}</option>`).join('')}</select>
<select name="status">
<option value="all">Tous</option>
<option value="retired" ${status==='retired'?'selected':''}>Retirés</option>
<option value="not" ${status==='not'?'selected':''}>Non retirés</option>
</select>
<button type="submit">🔍 Rechercher</button>
</form>
</div>

<a href="/transferts/pdf${req.url.split('?')[1]?'?'+req.url.split('?')[1]:''}">📄 Export PDF</a> |
<a href="/transferts/excel${req.url.split('?')[1]?'?'+req.url.split('?')[1]:''}">📊 Export Excel</a>`;

paginated.forEach(t=>{
  html+=`<div class="card">
<h3>Code: ${t.code}</h3>
<p><strong>Type:</strong> ${t.userType}</p>
<p><strong>Expéditeur:</strong> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
<p><strong>Origine:</strong> ${t.originLocation}</p>
<p><strong>Destinataire:</strong> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
<p><strong>Destination:</strong> ${t.destinationLocation}</p>
<p><strong>Montant:</strong> ${t.amount} ${t.currency}</p>
<p><strong>Frais:</strong> ${t.fees} ${t.currency}</p>
<p><strong>Reçu:</strong> ${t.recoveryAmount} ${t.currency}</p>
<p><strong>Status:</strong> <span class="status ${t.retired?'retiré':'non'}">${t.retired?'Retiré':'Non retiré'}</span></p>
<p><strong>Historique Retraits:</strong></p>${t.retraitHistory.map(r=>`<p>${new Date(r.date).toLocaleString()} - ${r.mode}</p>`).join('')}
<div class="actions">
<form method="post" action="/transferts/retire/${t._id}" style="display:inline"><button class="retire">${t.retired?'Annuler Retrait':'Retirer'}</button></form>
<form method="get" action="/transferts/form?code=${t.code}" style="display:inline"><button class="modify">✏️ Modifier</button></form>
<form method="post" action="/transferts/delete/${t._id}" style="display:inline" onsubmit="return confirm('Supprimer ce transfert ?');"><button class="delete">🗑 Supprimer</button></form>
<form method="get" action="/transferts/print/${t._id}" style="display:inline"><button class="print">🖨 Imprimer</button></form>
</div>
</div>`;
});

html+=`<div class="pagination">`;
for(let i=1;i<=totalPages;i++){
  html+=`<a href="/transferts/list?page=${i}">${i}</a>`;
}
html+=`</div></div></body></html>`;

res.send(html);

});

// ================= ACTIONS =================
app.post('/transferts/retire/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  t.retired = !t.retired;
  t.retraitHistory.push({date: new Date(), mode: req.session.user.username});
  await t.save();
  res.redirect('/transferts/list');
});

app.post('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  const doc = new PDFDocument({size:[250,400], margins:{top:10,left:10,right:10,bottom:10}});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`inline; filename=ticket_${t.code}.pdf`);
  doc.pipe(res);
  doc.fontSize(16).text(`Transfert ${t.code}`,{align:'center'});
  doc.moveDown();
  doc.fontSize(12).text(`Expéditeur: ${t.senderFirstName} ${t.senderLastName}`);
  doc.text(`Tel: ${t.senderPhone}`);
  doc.text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName}`);
  doc.text(`Tel: ${t.receiverPhone}`);
  doc.text(`Destination: ${t.destinationLocation}`);
  doc.text(`Montant: ${t.amount} ${t.currency}`);
  doc.text(`Frais: ${t.fees} ${t.currency}`);
  doc.text(`Reçu: ${t.recoveryAmount} ${t.currency}`);
  doc.text(`Statut: ${t.retired?'Retiré':'Non retiré'}`);
  doc.end();
});

app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
  doc.pipe(res);
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code: ${t.code} | Dest: ${t.destinationLocation} | Montant: ${t.amount} | Retiré: ${t.retired}`);
  });
  doc.end();
});

app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code', key:'code'},
    {header:'Expéditeur', key:'sender'},
    {header:'Destinataire', key:'receiver'},
    {header:'Destination', key:'destination'},
    {header:'Montant', key:'amount'},
    {header:'Frais', key:'fees'},
    {header:'Reçu', key:'recoveryAmount'},
    {header:'Retiré', key:'retired'}
  ];
  transferts.forEach(t=>{
    sheet.addRow({
      code:t.code,
      sender:`${t.senderFirstName} ${t.senderLastName}`,
      receiver:`${t.receiverFirstName} ${t.receiverLastName}`,
      destination:t.destinationLocation,
      amount:t.amount,
      fees:t.fees,
      recoveryAmount:t.recoveryAmount,
      retired:t.retired?'Oui':'Non'
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/logout', (req,res)=>{
  req.session.destroy();
  res.redirect('/login');
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`✅ Serveur lancé sur http://localhost:${PORT}`));
