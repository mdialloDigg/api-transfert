/******************************************************************
 * APP TRANSFERT – DASHBOARD FINAL
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

const requireRole = role => (req,res,next)=>{
  if(req.session.role===role) return next();
  res.status(403).send('Accès refusé');
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
<select name="role">
<option value="agent">Agent</option>
<option value="admin">Admin</option>
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
      req.session.user = username;
      req.session.role = role;
      return res.redirect('/menu');
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user = username;
    req.session.role = user.role;
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

  res.send(`...HTML FORMULAIRE MODERNE AVEC CODE, MONTANTS, EXPÉDITEUR, DESTINATAIRE (RESPONSIVE)...`); 
  // Pour ne pas surcharger ici, utilise le code front-end que je t’ai fourni précédemment
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
    // Redirige vers liste avec pré-remplissage recherche
    const params = `?searchCode=${code}`;
    res.redirect('/transferts/list'+params);
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
  }catch(err){console.error(err);res.status(500).send(err.message);}
});

// ================= LISTE / DASHBOARD =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const page = parseInt(req.query.page)||1;
  const limit = 10;
  const transferts = await Transfert.find().sort({ destinationLocation: 1, createdAt: -1 });
  
  // FILTRE
  let filtered = transferts;
  if(req.query.searchPhone){
    const phone = req.query.searchPhone.toLowerCase();
    filtered = filtered.filter(t=> t.senderPhone.toLowerCase().includes(phone) || t.receiverPhone.toLowerCase().includes(phone));
  }
  if(req.query.searchCode){
    const code = req.query.searchCode.toLowerCase();
    filtered = filtered.filter(t=> t.code.toLowerCase().includes(code));
  }
  if(req.query.searchName){
    const name = req.query.searchName.toLowerCase();
    filtered = filtered.filter(t=> t.receiverFirstName.toLowerCase().includes(name) || t.receiverLastName.toLowerCase().includes(name));
  }
  if(req.query.searchDest && req.query.searchDest!=='all'){
    filtered = filtered.filter(t=> t.destinationLocation===req.query.searchDest);
  }
  if(req.query.searchRetired==='oui') filtered = filtered.filter(t=> t.retired);
  if(req.query.searchRetired==='non') filtered = filtered.filter(t=> !t.retired);

  const totalPages = Math.ceil(filtered.length/limit);
  const grouped = {};
  filtered.slice((page-1)*limit, page*limit).forEach(t=>{
    if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[];
    grouped[t.destinationLocation].push(t);
  });

  res.send(`...HTML LISTE MODERNE AVEC CARDS, RETRAIT, HISTORIQUE, PAGINATION, EXPORT PDF/Excel...`);
  // Pour ne pas surcharger ici, utilise le code front-end responsive que je t’ai fourni précédemment
});

// ================= IMPRIMER TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;text-align:center;padding:20px;}
.ticket{border:1px dashed #333;padding:12px;width:280px;margin:auto;font-size:14px;}
button{margin-top:10px;padding:6px 12px;}
</style></head><body>
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
</div></body></html>`);
});

// ================= PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  try{
    const list = await Transfert.find().sort({destinationLocation:1});
    const doc = new PDFDocument({margin:20, size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'}); doc.moveDown();
    list.forEach(t=>{
      doc.fontSize(12).fillColor('black')
      .text(`Code:${t.code} | ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName}`)
      .text(`Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}`)
      .moveDown(0.5);
    });
    doc.end();
  }catch(err){console.error(err); res.status(500).send(err.message);}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
