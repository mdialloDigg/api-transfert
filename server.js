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

const authSchema = new mongoose.Schema({ username:String, password:String, userType:{type:String,default:'agent'} });
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
input,button,select{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#0056b3;}
</style></head><body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<select name="userType"><option value="agent">Agent</option><option value="admin">Administrateur</option></select><br>
<button>Connexion</button>
</form></body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password, userType } = req.body;
    const user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      await new Auth({ username, password: hashed, userType }).save();
      req.session.user = { username, userType };
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = { username, userType: user.userType };
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
<center><a href="/transferts/list">⬅ Retour liste</a></center>
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

// ================= SAUVEGARDE =================
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
    res.redirect(`/transferts/list?search=${code}`);
  }catch(err){ console.error(err);res.status(500).send(err.message);}
});

// ================= LISTE / DASHBOARD =================
app.get('/transferts/list', requireLogin, async (req,res)=>{
  try{
    const page = parseInt(req.query.page)||1;
    const limit = 10;
    const search = (req.query.search||'').toLowerCase();
    const statusFilter = req.query.status || 'all';

    let transferts = await Transfert.find().sort({createdAt:-1});

    // Filtrage global par tous les champs
    if(search){
      transferts = transferts.filter(t=>{
        return Object.values(t.toObject()).some(val=>{
          if(val===null || val===undefined) return false;
          return val.toString().toLowerCase().includes(search);
        });
      });
    }

    // Filtre retiré / non retiré
    if(statusFilter==='retire') transferts = transferts.filter(t=>t.retired);
    else if(statusFilter==='non') transferts = transferts.filter(t=>!t.retired);

    // Pagination
    const totalPages = Math.ceil(transferts.length/limit);
    const start = (page-1)*limit;
    const end = start + limit;
    const paged = transferts.slice(start,end);

    // HTML tableau
    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:Arial;background:#f4f6f9;padding:20px;}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:8px;text-align:center;}
    th{background:#007bff;color:white;}
    a,button{padding:4px 8px;margin:2px;border:none;border-radius:4px;cursor:pointer;text-decoration:none;}
    .modify{background:#28a745;color:white;} .delete{background:#dc3545;color:white;} .retirer{background:#17a2b8;color:white;}
    .pagination a{padding:6px 10px;margin:2px;background:#007bff;color:white;border-radius:4px;text-decoration:none;}
    </style>
    </head><body>
    <h2>📋 Liste des transferts</h2>
    <div>
      <form method="get">
        <input name="search" placeholder="Recherche globale" value="${req.query.search||''}">
        <select name="status">
          <option value="all" ${statusFilter==='all'?'selected':''}>Tous</option>
          <option value="retire" ${statusFilter==='retire'?'selected':''}>Retirés</option>
          <option value="non" ${statusFilter==='non'?'selected':''}>Non retirés</option>
        </select>
        <button type="submit">🔍 Rechercher</button>
      </form>
    </div>
    <table>
      <tr>
        <th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th>
        <th>Destinataire</th><th>Destination</th><th>Montant</th><th>Frais</th>
        <th>Reçu</th><th>Statut</th><th>Historique</th><th>Actions</th>
      </tr>`;

    paged.forEach(t=>{
      let hist = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>')||'-';
      html+=`<tr>
      <td>${t.code}</td>
      <td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.retired?'Retiré':'Non'}</td>
      <td>${hist}</td>
      <td>
        <a class="modify" href="/transferts/form?code=${t.code}">✏️ Modifier</a>
        <a class="delete" href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer suppression?')">❌ Supprimer</a>
        ${t.retired?'':`<form style="display:inline" method="post" action="/transferts/retirer">
        <input type="hidden" name="id" value="${t._id}">
        <select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option></select>
        <button class="retirer">Retirer</button>
        </form>`}
      </td>
      </tr>`;
    });

    html+=`</table>
    <div class="pagination">Pages: `;
    for(let i=1;i<=totalPages;i++){
      html+=`<a href="/transferts/list?page=${i}&search=${search}&status=${statusFilter}">${i}</a>`;
    }
    html+=`</div>
    <a href="/menu">⬅ Menu</a> | <a href="/transferts/pdf?search=${search}&status=${statusFilter}">📄 Export PDF</a> | 
    <a href="/transferts/excel?search=${search}&status=${statusFilter}">📊 Export Excel</a>
    </body></html>`;

    res.send(html);
  }catch(err){console.error(err);res.status(500).send(err.message);}
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      recoveryMode:req.body.mode,
      $push:{ retraitHistory:{ date:new Date(), mode:req.body.mode } }
    });
    res.redirect('back');
  }catch(err){ console.error(err);res.status(500).send(err.message);}
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('back');
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur ${PORT}`));
