/******************************************************************
 * APP TRANSFERT – VERSION FINALE CLÉ EN MAIN
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
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: false
}));

/* ================= DATABASE ================= */
mongoose.set('bufferCommands', false);
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert', {
  serverSelectionTimeoutMS: 5000
})
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>{
  console.error('❌ MongoDB erreur:', err.message);
  process.exit(1);
});

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType: String,
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
  currency: String,
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['Administrateur','Agent'], default: 'Agent' }
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= UTILS ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const requireRole = role => (req,res,next)=>{
  if(req.session.userRole===role || req.session.userRole==='Administrateur') return next();
  res.send('❌ Accès refusé');
};

async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65 + Math.random()*26|0) + (100 + Math.random()*900|0);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<html><style>
body{font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px}
form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,.2)}
input,button,select{padding:12px;margin:6px;width:240px}
button{background:#007bff;color:white;border:none;border-radius:6px}
</style>
<form method="post">
<h2>Connexion</h2>
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<select name="role">
<option value="Administrateur">Administrateur</option>
<option value="Agent">Agent</option>
</select><br>
<button>Connexion</button>
</form>
</html>
`);
});

app.post('/login', async(req,res)=>{
  let user = await Auth.findOne({ username:req.body.username });
  if(!user){
    user = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10),
      role:req.body.role
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,user.password))
    return res.send('Mot de passe incorrect');
  req.session.user = user.username;
  req.session.userRole = user.role;
  res.redirect('/menu');
});

/* ================= MENU ================= */
app.get('/menu', requireLogin,(req,res)=>{
res.send(`
<html><style>
body{text-align:center;background:#eef2f7;font-family:Arial;padding-top:50px}
button{width:280px;padding:15px;margin:12px;border-radius:8px;border:none;color:white;font-size:16px}
.send{background:#007bff}.list{background:#28a745}.logout{background:#dc3545}
</style>
<h2>📲 Gestion des transferts</h2>
<a href="/transferts/form"><button class="send">➕ Envoyer de l'argent</button></a><br>
<a href="/transferts/list"><button class="list">📋 Liste / Dashboard</button></a><br>
<a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
</html>`);
});

/* ================= FORMULAIRE ================= */
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t ? t.code : await generateUniqueCode();
res.send(`
<html><style>
body{background:#f0f4f8;font-family:Arial}
.container{max-width:860px;margin:30px auto;background:#fff;padding:25px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,.15)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px}
input,select{padding:10px;border-radius:6px;border:1px solid #ccc}
input[readonly]{background:#e9ecef}
button{width:100%;padding:14px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:16px}
</style>
<div class="container">
<h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
<form method="post">

<h3>Code transfert</h3>
<input type="text" name="code" value="${code}" required>

<h3>Type de personne</h3>
<select name="userType">
${['Client','Distributeur','Administrateur','Agence de transfert']
.map(v=>`<option ${t?.userType===v?'selected':''}>${v}</option>`).join('')}
</select>

<h3>Expéditeur</h3>
<div class="grid">
<input name="senderFirstName" placeholder="Prénom" value="${t?.senderFirstName||''}" required>
<input name="senderLastName" placeholder="Nom" value="${t?.senderLastName||''}" required>
<input name="senderPhone" placeholder="Téléphone" value="${t?.senderPhone||''}" required>
<input name="originLocation" placeholder="Origine" value="${t?.originLocation||''}" required>
</div>

<h3>Destinataire</h3>
<div class="grid">
<input name="receiverFirstName" placeholder="Prénom" value="${t?.receiverFirstName||''}" required>
<input name="receiverLastName" placeholder="Nom" value="${t?.receiverLastName||''}" required>
<input name="receiverPhone" placeholder="Téléphone" value="${t?.receiverPhone||''}" required>
<input name="destinationLocation" placeholder="Destination" value="${t?.destinationLocation||''}" required>
</div>

<h3>Montants</h3>
<div class="grid">
<input type="number" name="amount" id="amount" placeholder="Montant" value="${t?.amount||''}" required>
<input type="number" name="fees" id="fees" placeholder="Frais" value="${t?.fees||''}" required>
<input readonly id="recovery">
<select name="currency">
${['GNF','EUR','USD','XOF'].map(c=>`<option ${t?.currency===c?'selected':''}>${c}</option>`).join('')}
</select>
</div>

<button>Enregistrer</button>
</form>
</div>

<script>
const a=document.getElementById('amount');
const f=document.getElementById('fees');
const r=document.getElementById('recovery');
function calc(){r.value=(a.value||0)-(f.value||0);}
a.oninput=f.oninput=calc; calc();
</script>
</html>
`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount);
  const fees = Number(req.body.fees);
  const recoveryAmount = amount - fees;
  const data = {...req.body, amount, fees, recoveryAmount};
  const exist = await Transfert.findOne({code:req.body.code});
  if(exist) await Transfert.updateOne({_id:exist._id},data);
  else await new Transfert(data).save();

  // Préremplissage recherche
  const params = new URLSearchParams({
    searchPhone: req.body.senderPhone,
    searchCode: req.body.code,
    searchName: req.body.receiverLastName
  }).toString();
  res.redirect('/transferts/list?' + params);
});

/* ================= LISTE COMPACTE ================= */
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const perPage = 10;
  const page = Number(req.query.page) || 1;

  let list = await Transfert.find().sort({destinationLocation:1, createdAt:-1});
  if(req.query.searchPhone) list = list.filter(t=>t.senderPhone.includes(req.query.searchPhone));
  if(req.query.searchCode) list = list.filter(t=>t.code.includes(req.query.searchCode));
  if(req.query.searchName) list = list.filter(t=>t.receiverLastName.toLowerCase().includes(req.query.searchName.toLowerCase()));

  const totalPages = Math.ceil(list.length/perPage);
  const pageList = list.slice((page-1)*perPage,page*perPage);

  const grouped = {};
  pageList.forEach(t=>{
    if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[];
    grouped[t.destinationLocation].push(t);
  });

res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9;padding:10px}
.card{background:#fff;border-radius:10px;padding:10px;margin:5px;box-shadow:0 3px 8px rgba(0,0,0,.1);font-size:14px}
.actions button{margin:2px;padding:5px 8px;border-radius:5px;border:none;color:white;font-size:12px}
.modify{background:#28a745}.delete{background:#dc3545}.print{background:#17a2b8}.retirer{background:#007bff}
</style></head><body>
<h1>📄 Liste des transferts</h1>

<form method="get">
<input name="searchPhone" placeholder="Téléphone" value="${req.query.searchPhone||''}">
<input name="searchCode" placeholder="Code" value="${req.query.searchCode||''}">
<input name="searchName" placeholder="Nom destinataire" value="${req.query.searchName||''}">
<button>🔍 Rechercher</button>
</form>

${Object.keys(grouped).map(dest=>`
<h2>${dest}</h2>
${grouped[dest].map(t=>`
<div class="card">
<b>Code:</b> ${t.code}<br>
<b>Expéditeur:</b> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})<br>
<b>Destinataire:</b> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})<br>
<b>Montant:</b> ${t.amount} ${t.currency} | <b>Reçu:</b> ${t.recoveryAmount}<br>
<b>Statut:</b> ${t.retired?'Retiré':'Non retiré'}<br>
<b>Historique:</b><br>
${t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>') || '-'}
<div class="actions">
<a href="/transferts/form?code=${t.code}"><button class="modify">✏️</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')"><button class="delete">❌</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️</button></a>
${!t.retired?`<form method="post" action="/transferts/retirer" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select>
<button class="retirer">Retirer</button>
</form>`:''}
</div></div>`).join('')}
`).join('')}

<div style="text-align:center;margin-top:10px">
${page>1?`<a href="?page=${page-1}">⬅ Précédent</a>`:''} Page ${page}/${totalPages} ${page<totalPages?`<a href="?page=${page+1}">Suivant ➡</a>`:''}
</div>

<a href="/transferts/pdf">📄 Export PDF</a> | <a href="/transferts/excel">📊 Export Excel</a>
</body></html>
`);
});

/* ================= RETRAIT ================= */
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.body.id);
  if(!t) return res.send('Transfert introuvable');
  t.retired=true;
  t.recoveryMode=req.body.mode;
  t.retraitHistory.push({date:new Date(),mode:req.body.mode});
  await t.save();
  res.redirect('back');
});

/* ================= SUPPRIMER ================= */
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('back');
});

/* ================= IMPRIMER TICKET ================= */
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`
<html><style>
body{font-family:Arial;text-align:center;padding:20px}
.ticket{border:1px dashed #333;padding:15px;width:280px;margin:auto;font-size:14px}
button{margin-top:10px;padding:8px 15px}
</style>
<div class="ticket">
<h3>💰 Transfert</h3>
<p>Code: ${t.code}</p>
<p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
<p>Tél: ${t.senderPhone}</p>
<p>Origine: ${t.originLocation}</p>
<p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
<p>Tél: ${t.receiverPhone}</p>
<p>Destination: ${t.destinationLocation}</p>
<p>Montant: ${t.amount} ${t.currency}</p>
<p>Frais: ${t.fees} ${t.currency}</p>
<p>À recevoir: ${t.recoveryAmount} ${t.currency}</p>
<p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
<button onclick="window.print()">🖨️ Imprimer</button>
</div></html>
`);
});

/* ================= EXPORT PDF ================= */
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const list = await Transfert.find().sort({destinationLocation:1});
  const doc = new PDFDocument({margin:30, size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
  doc.pipe(res);
  doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'}); doc.moveDown();
  list.forEach(t=>{
    doc.fontSize(12).text(`Code: ${t.code} | ${t.senderFirstName} -> ${t.receiverFirstName} | Montant: ${t.amount} | Statut: ${t.retired?'Retiré':'Non retiré'}`);
  });
  doc.end();
});

/* ================= EXPORT EXCEL ================= */
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  try{
    const list = await Transfert.find();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transferts');
    sheet.columns = [
      {header:'Code', key:'code', width:10},
      {header:'Expéditeur', key:'sender', width:20},
      {header:'Téléphone', key:'senderPhone', width:15},
      {header:'Destinataire', key:'receiver', width:20},
      {header:'Téléphone Dest.', key:'receiverPhone', width:15},
      {header:'Destination', key:'destination', width:15},
      {header:'Montant', key:'amount', width:12},
      {header:'Frais', key:'fees', width:10},
      {header:'Reçu', key:'recovery', width:12},
      {header:'Devise', key:'currency', width:8},
      {header:'Statut', key:'status', width:12},
      {header:'Historique Retrait', key:'history', width:30},
      {header:'Date', key:'createdAt', width:20}
    ];
    list.forEach(t=>{
      sheet.addRow({
        code: t.code,
        sender: `${t.senderFirstName} ${t.senderLastName}`,
        senderPhone: t.senderPhone,
        receiver: `${t.receiverFirstName} ${t.receiverLastName}`,
        receiverPhone: t.receiverPhone,
        destination: t.destinationLocation,
        amount: t.amount,
        fees: t.fees,
        recovery: t.recoveryAmount,
        currency: t.currency,
        status: t.retired ? 'Retiré' : 'Non retiré',
        history: t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('; '),
        createdAt: t.createdAt.toLocaleString()
      });
    });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  }catch(e){res.send('Erreur Excel '+e.message);}
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>{
  req.session.destroy(); res.redirect('/login');
});

/* ================= SERVEUR ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
