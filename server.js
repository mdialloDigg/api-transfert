/******************************************************************
 * APP TRANSFERT – SERVER EXPRESS + MONGODB + AJAX + EXPORTS
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
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

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
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode() {
  let code; let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = letter + number;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// ================= CONSTANTS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Connexion</title><style>body{margin:0;font-family:Arial;background:#f0f4f8;display:flex;justify-content:center;align-items:center;height:100vh;} .login-container{background:#fff;padding:30px 40px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.2);width:320px;text-align:center;} h2{color:#2c7be5;margin-bottom:20px;} input{width:100%;padding:12px;margin:8px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;} button{width:100%;padding:12px;margin-top:10px;border:none;border-radius:8px;background:#007bff;color:white;font-weight:bold;font-size:15px;cursor:pointer;transition:0.3s;} button:hover{background:#0056b3;}</style></head><body><div class="login-container"><h2>Connexion</h2><form method="POST" action="/login"><input type="text" name="username" placeholder="Utilisateur" required><input type="password" name="password" placeholder="Mot de passe" required><button>Se connecter</button></form></div></body></html>');
});

app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = await new Auth({ username, password: hashed }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username };
  res.redirect('/transferts');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= TRANSFERTS PAGE =================
app.get('/transferts', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  res.send('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Transferts</title><style>body{font-family:Arial;margin:10px;background:#f4f6f9;} h2{color:#2c7be5;text-align:center;margin-bottom:15px;} .table-container{width:100%;overflow-x:auto;max-height:60vh;border:1px solid #ccc;border-radius:5px;background:#fff;position:relative;} table{width:100%;border-collapse: collapse;min-width:900px;} th, td{border:1px solid #ccc;padding:8px;text-align:left;font-size:14px;} th{background:#007bff;color:white;position: sticky;top:0;z-index:2;} .retired{background:#fff3b0;} button, a.button{padding:6px 10px;border:none;border-radius:5px;color:white;text-decoration:none;font-size:12px;cursor:pointer;margin-right:3px;} .modify{background:#28a745;} .delete{background:#dc3545;} .retirer{background:#ff9900;} .imprimer{background:#17a2b8;} .export{background:#6c757d;} #filters{display:flex;flex-wrap: wrap;gap:10px;margin-bottom:10px;} #filters input,#filters select{padding:6px;border-radius:5px;border:1px solid #ccc;font-size:14px;} #loadingSpinner{display:none;position:absolute;top:50%;left:50%;transform: translate(-50%, -50%);width:40px;height:40px;border:5px solid #ccc;border-top:5px solid #007bff;border-radius:50%;animation: spin 1s linear infinite;} @keyframes spin{0%{transform: translate(-50%, -50%) rotate(0deg);}100%{transform: translate(-50%, -50%) rotate(360deg);}} @media (max-width:768px){td{display:flex;justify-content:space-between;padding:6px;border-bottom:1px solid #ccc;} td button, td a.button{margin-left:5px;margin-top:0;flex-shrink:0;} td::before{content: attr(data-label);font-weight:bold;flex:1;}}</style></head><body><h2>📋 Liste des transferts</h2><div id="filters"><input id="searchInput" placeholder="Recherche..."><select id="statusSelect"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select><select id="currencySelect"><option value="">Toutes devises</option><option value="GNF">GNF</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="XOF">XOF</option></select><select id="destinationSelect"><option value="">Toutes destinations</option>'+locations.map(function(v){return '<option value="'+v+'">'+v+'</option>';}).join('')+'</select><a href="/transferts/excel" class="button export">📊 Excel</a><a href="/transferts/word" class="button export">📄 Word</a><a href="/logout" class="button delete">🚪 Déconnexion</a></div><div class="table-container"><div id="loadingSpinner"></div><table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody id="transfertsBody"></tbody></table></div><script>async function fetchTransferts(){var search=document.getElementById("searchInput").value;var status=document.getElementById("statusSelect").value;var currency=document.getElementById("currencySelect").value;var destination=document.getElementById("destinationSelect").value;var url="/transferts/data?search="+encodeURIComponent(search)+"&status="+encodeURIComponent(status)+"&currency="+encodeURIComponent(currency)+"&destination="+encodeURIComponent(destination);var res=await fetch(url);var data=await res.json();var tbody=document.getElementById("transfertsBody");tbody.innerHTML="";data.transferts.forEach(function(t){var tr=document.createElement("tr");if(t.retired)tr.className="retired";var actions="<button class='modify' onclick='editTransfert(\""+t._id+"\")'>✏️</button>";tr.innerHTML="<td>"+t.code+"</td><td>"+t.userType+"</td><td>"+t.senderFirstName+" "+t.senderLastName+" ("+t.senderPhone+")</td><td>"+t.originLocation+"</td><td>"+t.receiverFirstName+" "+t.receiverLastName+" ("+t.receiverPhone+")</td><td>"+t.amount+"</td><td>"+t.fees+"</td><td>"+t.recoveryAmount+"</td><td>"+t.currency+"</td><td>"+(t.retired?"Retiré":"Non retiré")+"</td><td>"+actions+"</td>";tbody.appendChild(tr);});}document.getElementById("searchInput").addEventListener("input",fetchTransferts);document.getElementById("statusSelect").addEventListener("change",fetchTransferts);document.getElementById("currencySelect").addEventListener("change",fetchTransferts);document.getElementById("destinationSelect").addEventListener("change",fetchTransferts);fetchTransferts();</script></body></html>');
});

// ================= DATA API =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  const search = req.query.search || '';
  const status = req.query.status || 'all';
  const currency = req.query.currency || '';
  const destination = req.query.destination || '';
  const query = {};
  if(search){
    const regex = new RegExp(search, 'i');
    query.$or = [{code:regex},{senderFirstName:regex},{senderLastName:regex},{senderPhone:regex},{receiverFirstName:regex},{receiverLastName:regex},{receiverPhone:regex}];
  }
  if(status==='retire') query.retired=true;
  if(status==='non') query.retired=false;
  if(currency) query.currency = currency;
  if(destination) query.destinationLocation = destination;
  const transferts = await Transfert.find(query);
  res.json({ transferts });
});

// ================= EXPORTS =================
// Excel
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
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

// Word
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const doc = new Document();
  transferts.forEach(function(t){
    doc.addSection({children:[
      new Paragraph({children:[new TextRun('Code: '+t.code+' Type: '+t.userType+' Expéditeur: '+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+') Destinataire: '+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+') Montant: '+t.amount+' '+t.currency+' Frais: '+t.fees+' Reçu: '+t.recoveryAmount+' Statut: '+(t.retired?'Retiré':'Non retiré'))]})
    ]});
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('🚀 Serveur lancé sur http://localhost:'+PORT));
