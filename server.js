/******************************************************************
 * APP TRANSFERT – DASHBOARD FINAL AVEC AJAX, TOTAUX, EXPORTS
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

// ================= AUTH / PERMISSIONS =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

function setPermissions(username){
  let permissions = { lecture:true, ecriture:false, retrait:false, modification:true, suppression:true, imprimer:true };
  if(username === 'a'){ permissions = { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true }; }
  if(username === 'admin2'){ permissions = { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true }; }
  return permissions;
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
    const permissions = setPermissions(username);
    req.session.user = { username:user.username, role:user.role, permissions };
    res.redirect('/transferts');
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur: '+err.message);}
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/transferts', requireLogin, async(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#007bff;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  input, select{margin:4px;padding:6px;border-radius:4px;}
  #modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);}
  #modalContent{background:white;margin:50px auto;padding:20px;max-width:500px;border-radius:10px;}
  </style></head><body>

  <h2>📋 Transferts</h2>

  <input type="text" id="searchInput" placeholder="Recherche...">
  <select id="statusSelect"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
  <select id="currencySelect"><option value="">Toutes devises</option>${currencies.map(c=>`<option value="${c}">${c}</option>`).join('')}</select>
  <select id="destinationSelect"><option value="">Toutes destinations</option>${locations.map(l=>`<option value="${l}">${l}</option>`).join('')}</select>
  <button onclick="fetchTransferts()">Filtrer</button>
  ${req.session.user.permissions.ecriture?'<button id="newTransfert">➕ Nouveau</button>':''}
  <a href="/transferts/excel">📊 Export Excel</a>
  <a href="/transferts/word">📄 Export Word</a>
  <a href="/logout">🚪 Déconnexion</a>

  <div id="totaux"></div>
  <table><thead>
  <tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
  </thead><tbody id="transfertsBody"></tbody></table>

  <!-- Modal -->
  <div id="modal">
    <div id="modalContent">
      <h3 id="modalTitle">Transfert</h3>
      <form id="transfertForm">
        <input type="hidden" name="id">
        Type: <select name="userType"><option>Client</option><option>Distributeur</option><option>Administrateur</option><option>Agence de transfert</option></select><br>
        Expéditeur: <input name="senderFirstName" placeholder="Prénom"> <input name="senderLastName" placeholder="Nom"> <input name="senderPhone" placeholder="Téléphone"><br>
        Origine: <select name="originLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select><br>
        Destinataire: <input name="receiverFirstName" placeholder="Prénom"> <input name="receiverLastName" placeholder="Nom"> <input name="receiverPhone" placeholder="Téléphone"><br>
        Destination: <select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select><br>
        Montant: <input type="number" name="amount" value="0"> Frais: <input type="number" name="fees" value="0"> Montant reçu: <input type="text" name="recoveryAmount" readonly><br>
        Devise: <select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select><br>
        <button>Enregistrer</button>
        <button type="button" id="modalClose">Fermer</button>
      </form>
    </div>
  </div>

  <script>
  // ================= SCRIPT AJAX COMPLET =================
  ${/** Copie le script AJAX complet avec imprimer ligne fourni dans la réponse précédente */}
  </script>

  </body></html>`);
});

// ================= ROUTES AJAX / CRUD =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  let {search='', status='all', currency='', destination=''} = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  transferts = transferts.filter(t=>{
    return (t.code.toLowerCase().includes(search.toLowerCase()) ||
            t.senderFirstName.toLowerCase().includes(search.toLowerCase()) ||
            t.senderLastName.toLowerCase().includes(search.toLowerCase()) ||
            t.senderPhone.toLowerCase().includes(search.toLowerCase()) ||
            t.receiverFirstName.toLowerCase().includes(search.toLowerCase()) ||
            t.receiverLastName.toLowerCase().includes(search.toLowerCase()) ||
            t.receiverPhone.toLowerCase().includes(search.toLowerCase()));
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  if(status==='non') transferts = transferts.filter(t=>!t.retired);
  if(currency) transferts = transferts.filter(t=>t.currency===currency);
  if(destination) transferts = transferts.filter(t=>t.destinationLocation===destination);
  res.json(transferts);
});

app.get('/transferts/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.json(t);
});

app.post('/transferts', requireLogin, async(req,res)=>{
  let code = await generateUniqueCode();
  let t = new Transfert({...req.body, code});
  await t.save();
  res.json({success:true});
});

app.put('/transferts/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.params.id, req.body);
  res.json({success:true});
});

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true});
  res.json({success:true});
});

app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  var transferts = await Transfert.find();
  var workbook = new ExcelJS.Workbook();
  var sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code', key:'code'},
    {header:'Type', key:'userType'},
    {header:'Expéditeur', key:'sender'},
    {header:'Origine', key:'origin'},
    {header:'Destinataire', key:'receiver'},
    {header:'Montant', key:'amount'},
    {header:'Frais', key:'fees'},
    {header:'Reçu', key:'recovery'},
    {header:'Devise', key:'currency'},
    {header:'Status', key:'status'}
  ];
  transferts.forEach(function(t){
    sheet.addRow({
      code: t.code,
      userType: t.userType,
      sender: t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')',
      origin: t.originLocation,
      receiver: t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')',
      amount: t.amount,
      fees: t.fees,
      recovery: t.recoveryAmount,
      currency: t.currency,
      status: t.retired?'Retiré':'Non retiré'
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res); res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  var transferts = await Transfert.find();
  var doc = new Document();
  transferts.forEach(function(t){
    doc.addSection({children:[
      new Paragraph({children:[new TextRun('Code: '+t.code+' Type: '+t.userType+' Expéditeur: '+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+') Destinataire: '+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+') Montant: '+t.amount+' '+t.currency+' Frais: '+t.fees+' Reçu: '+t.recoveryAmount+' Statut: '+(t.retired?'Retiré':'Non retiré'))]})
    ]});
  });
  var buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
