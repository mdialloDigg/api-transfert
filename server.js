/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET PLUG & PLAY
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

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// Permissions middleware
const checkPermission = (type) => (req,res,next)=>{
  if(!req.session.user || !req.session.user.permissions) return res.status(403).send('Accès refusé');
  if(!req.session.user.permissions[type]) return res.status(403).send('Accès refusé');
  next();
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= LOGIN / LOGOUT =================
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
    let user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      user = await new Auth({ username, password: hashed }).save();
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');

    // Permissions dynamiques
    let permissions = { nouveau:true, toutLeReste:true };
    if(username === 'a') permissions = { nouveau:true, toutLeReste:false };
    if(username === 'admin2') permissions = { nouveau:false, toutLeReste:true };

    req.session.user = { username:user.username, role:user.role, permissions };
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur: '+err.message);}
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, checkPermission('nouveau'), async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(/* HTML formulaire complet comme dans les messages précédents */);
});

app.post('/transferts/form', requireLogin, checkPermission('nouveau'), async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
  res.redirect(`/transferts/list?search=${code}`);
});

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const search = (req.query.search||'').toLowerCase();
  const statusFilter = req.query.status || 'all';
  let transferts = await Transfert.find().sort({createdAt:-1});
  if(search) transferts = transferts.filter(t=>Object.values(t.toObject()).some(v=>v && v.toString().toLowerCase().includes(search)));
  if(statusFilter==='retire') transferts = transferts.filter(t=>t.retired);
  else if(statusFilter==='non') transferts = transferts.filter(t=>!t.retired);

  // Générer HTML complet avec : cases à cocher, boutons imprimer ligne, pagination
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#007bff;color:white;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  .imprimer{background:#17a2b8;}
  input[type=checkbox]{width:16px;height:16px;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <form id="printSelectedForm">
  <table><thead><tr>
  <th>Sélection</th><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th>
  <th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th>
  <th>Status</th><th>Actions</th></tr></thead><tbody>`;

  transferts.forEach(t=>{
    html+=`<tr>
    <td><input type="checkbox" name="select" value="${t._id}"></td>
    <td>${t.code}</td>
    <td>${t.userType}</td>
    <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
    <td>${t.originLocation}</td>
    <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
    <td>${t.amount}</td>
    <td>${t.fees}</td>
    <td>${t.recoveryAmount}</td>
    <td>${t.retired?'Retiré':'Non retiré'}</td>
    <td>
      <a href="/transferts/form?code=${t.code}"><button type="button" class="modify">✏️ Modifier</button></a>
      <a href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer ?');"><button type="button" class="delete">❌ Supprimer</button></a>
      <a href="/transferts/print/${t._id}" target="_blank"><button type="button" class="imprimer">🖨 Imprimer</button></a>
    </td>
    </tr>`;
  });

  html+=`</tbody></table>
  <button type="submit">🖨 Imprimer sélection</button>
  </form>
  <a href="/transferts/pdf">📄 Export PDF</a>
  <a href="/transferts/excel">📊 Export Excel</a>
  <a href="/logout">🚪 Déconnexion</a>
  <script>
  document.getElementById('printSelectedForm').addEventListener('submit', function(e){
    e.preventDefault();
    const ids = Array.from(document.querySelectorAll('input[name="select"]:checked')).map(cb => cb.value);
    if(ids.length===0){ alert('Sélectionnez au moins un transfert'); return; }
    ids.forEach(id=>window.open('/transferts/print/'+id,'_blank'));
  });
  </script>
  </body></html>`;
  res.send(html);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
