/******************************************************************
 * APP TRANSFERT – SERVEUR COMPLET AVEC AJAX
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
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
    code = letter+number;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  let permissions = { lecture:true, ecriture:false, retrait:false, modification:true, suppression:true, imprimer:true };
  if(username === 'a'){ permissions = { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true }; }
  if(username === 'admin2'){ permissions = { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true }; }
  return permissions;
}

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}button:hover{background:#0056b3;}</style></head><body><h2>Connexion</h2><form method="post"><input name="username" placeholder="Utilisateur" required><br><input type="password" name="password" placeholder="Mot de passe" required><br><button>Connexion</button></form></body></html>');
});
app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password: hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions: setPermissions(username) };
  res.redirect('/transferts/list');
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= LIST PAGE AVEC AJAX =================
app.get('/transferts/list', requireLogin, (req,res)=>{
  let optionsLocation=''; locations.forEach(l=>{optionsLocation+='<option value="'+l+'">'+l+'</option>';});
  let optionsCurrency=''; currencies.forEach(c=>{optionsCurrency+='<option value="'+c+'">'+c+'</option>';});
  res.send('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9;}table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}th{background:#007bff;color:white;}.retired{background:#fff3b0;}button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}.modify{background:#28a745;}.delete{background:#dc3545;}.retirer{background:#ff9900;}.imprimer{background:#17a2b8;}@media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}</style></head><body><h2>📋 Liste des transferts</h2><div><input id="search" placeholder="Recherche..."><select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select><select id="currency"><option value="">Toutes devises</option>'+optionsCurrency+'</select><select id="destination"><option value="">Toutes destinations</option>'+optionsLocation+'</select><button onclick="loadData()">🔍 Filtrer</button> <a href="/logout">🚪 Déconnexion</a> <a href="/transferts/excel">📊 Excel</a><a href="/transferts/word">📝 Word</a><table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody id="tbody"></tbody></table><h3>📊 Totaux par destination et devise</h3><div id="totaux"></div></div><script>async function loadData(){var search=document.getElementById("search").value;var status=document.getElementById("status").value;var currency=document.getElementById("currency").value;var destination=document.getElementById("destination").value;var response=await fetch("/transferts/data?search="+encodeURIComponent(search)+"&status="+encodeURIComponent(status)+"&currency="+encodeURIComponent(currency)+"&destination="+encodeURIComponent(destination));var data=await response.json();var tbody=document.getElementById("tbody");tbody.innerHTML="";var totals={};data.forEach(function(t){var tr=document.createElement("tr");if(t.retired)tr.className="retired";tr.innerHTML="<td>"+t.code+"</td><td>"+t.userType+"</td><td>"+t.senderFirstName+" "+t.senderLastName+" ("+t.senderPhone+")</td><td>"+t.originLocation+"</td><td>"+t.receiverFirstName+" "+t.receiverLastName+" ("+t.receiverPhone+")</td><td>"+t.amount+"</td><td>"+t.fees+"</td><td>"+t.recoveryAmount+"</td><td>"+t.currency+"</td><td>"+(t.retired?"Retiré":"Non retiré")+"</td><td><button class=\'modify\' onclick=\'edit(\""+t._id+"\")\'>✏️</button><button class=\'delete\' onclick=\'remove(\""+t._id+"\")\'>❌</button><button class=\'retirer\' onclick=\'retirer(\""+t._id+"\")\'>💰</button><button class=\'imprimer\' onclick=\'imprimer(\""+t._id+"\")\'>🖨</button></td>";tbody.appendChild(tr);if(!totals[t.destinationLocation])totals[t.destinationLocation]={};if(!totals[t.destinationLocation][t.currency])totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};totals[t.destinationLocation][t.currency].amount+=t.amount;totals[t.destinationLocation][t.currency].fees+=t.fees;totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;});var divtot=document.getElementById("totaux");divtot.innerHTML="";for(var dest in totals){for(var curr in totals[dest]){divtot.innerHTML+="<p>"+dest+" | "+curr+" : Montant="+totals[dest][curr].amount+", Frais="+totals[dest][curr].fees+", Reçu="+totals[dest][curr].recovery+"</p>";}}}function edit(id){alert('Modifier '+id);}function remove(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}function retirer(id){var mode=prompt('Mode de retrait: Espèces, Orange Money, Wave');if(mode)fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);}function imprimer(id){window.open('/transferts/print/'+id,'_blank');}window.onload=loadData;</script></body></html>');
});

// ================= AJAX DATA =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  let { search='', status='all', currency='', destination='' } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  search=search.toLowerCase();
  transferts=transferts.filter(t=>t.code.toLowerCase().includes(search)||t.senderFirstName.toLowerCase().includes(search)||t.senderLastName.toLowerCase().includes(search)||t.senderPhone.toLowerCase().includes(search)||t.receiverFirstName.toLowerCase().includes(search)||t.receiverLastName.toLowerCase().includes(search)||t.receiverPhone.toLowerCase().includes(search));
  if(status==='retire') transferts=transferts.filter(t=>t.retired);
  else if(status==='non') transferts=transferts.filter(t=>!t.retired);
  if(currency) transferts=transferts.filter(t=>t.currency===currency);
  if(destination) transferts=transferts.filter(t=>t.destinationLocation===destination);
  res.json(transferts);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
