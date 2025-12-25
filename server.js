/******************************************************************
 * APP TRANSFERT – DASHBOARD ALL-IN-ONE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();
app.use(express.urlencoded({ extended:true }));
app.use(express.json());
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number,
  currency:{type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF'},
  recoveryMode:String, retraitHistory:[{date:Date,mode:String}], retired:{type:Boolean,default:false},
  code:{type:String,unique:true}, createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const authSchema = new mongoose.Schema({username:String,password:String});
const Auth = mongoose.model('Auth',authSchema);

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = `${String.fromCharCode(65+Math.floor(Math.random()*26))}${Math.floor(100+Math.random()*900)}`;
    exists = await Transfert.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial;background:#f4f6f8;display:flex;align-items:center;justify-content:center;height:100vh;}
form{background:#fff;padding:50px;border-radius:15px;box-shadow:0 8px 25px rgba(0,0,0,0.2);width:320px;}
h2{text-align:center;color:#2c7be5;margin-bottom:20px;}
input,button{width:100%;padding:12px;margin:10px 0;border-radius:8px;border:1px solid #ccc;font-size:16px;}
button{background:#2c7be5;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#1a5bb8;}
</style></head><body>
<form method="post"><h2>Connexion</h2>
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Connexion</button></form></body></html>`);
});

app.post('/login', async(req,res)=>{
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    await new Auth({username,password:hashed}).save();
    req.session.user=username;
    return res.redirect('/menu');
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/menu');
});

// ================= DASHBOARD ALL-IN-ONE =================
app.get('/menu', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1});
  const totalMontant = transferts.reduce((a,b)=>a+b.amount,0);
  const totalFrais = transferts.reduce((a,b)=>a+b.fees,0);
  const totalRecu = transferts.reduce((a,b)=>a+b.recoveryAmount,0);
  const retirés = transferts.filter(t=>t.retired).length;
  const nonRetirés = transferts.filter(t=>!t.retired).length;

  const devises = {GNF:0,EUR:0,USD:0,XOF:0};
  transferts.forEach(t=>{devises[t.currency]++;});
  const destinations = {};
  transferts.forEach(t=>{destinations[t.destinationLocation]=(destinations[t.destinationLocation]||0)+1;});

  res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{margin:0;font-family:Arial;display:flex;}
.sidebar{width:220px;background:#2c7be5;color:white;height:100vh;position:fixed;display:flex;flex-direction:column;}
.sidebar h2{text-align:center;padding:20px 0;border-bottom:1px solid rgba(255,255,255,0.3);}
.sidebar a{color:white;text-decoration:none;padding:15px 20px;border-bottom:1px solid rgba(255,255,255,0.1);}
.sidebar a:hover{background:#1a5bb8;}
.main{margin-left:220px;padding:30px;width:100%;background:#f4f6f8;min-height:100vh;}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:30px;}
.card{background:white;padding:20px;border-radius:12px;box-shadow:0 6px 15px rgba(0,0,0,0.1);text-align:center;}
.card h3{margin:0;color:#2c7be5;}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 6px 15px rgba(0,0,0,0.1);}
th,td{padding:10px;text-align:center;border-bottom:1px solid #eee;font-size:14px;}
th{background:#2c7be5;color:white;}
tr:hover{background:#f1f5f9;}
input#searchPhone{width:100%;max-width:400px;padding:10px;margin-bottom:10px;border-radius:8px;border:1px solid #ccc;}
button{padding:5px 10px;margin:2px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}
button.delete{background:#dc3545;color:white;} button.print{background:#17a2b8;color:white;} button.retire{background:#28a745;color:white;}
</style>
</head><body>
<div class="sidebar">
<h2>💰 Transferts</h2>
<a href="/menu">Dashboard</a>
<a href="/transferts/new">➕ Nouveau</a>
<a href="#list">📋 Liste</a>
<a href="/transferts/pdf">📄 PDF</a>
<a href="/logout">🚪 Déconnexion</a>
</div>
<div class="main">
<h1>📊 Dashboard</h1>
<div class="cards">
<div class="card"><h3>Total Montant</h3><p>${totalMontant}</p></div>
<div class="card"><h3>Total Frais</h3><p>${totalFrais}</p></div>
<div class="card"><h3>Total Reçu</h3><p>${totalRecu}</p></div>
<div class="card"><h3>Retirés / Non Retirés</h3><p>${retirés} / ${nonRetirés}</p></div>
</div>

<h2>Répartition par devise</h2>
<canvas id="chartDevise" width="400" height="200"></canvas>
<h2>Répartition par destination</h2>
<canvas id="chartDest" width="400" height="200"></canvas>

<h2 id="list">Liste des transferts</h2>
<input type="text" id="searchPhone" placeholder="🔍 Rechercher par téléphone ou code">
<table id="transfertsTable">
<thead>
<tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Destinataire</th><th>Tél</th><th>Code</th><th>Statut</th><th>Actions</th></tr>
</thead>
<tbody>
${transferts.map(t=>`
<tr>
<td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.recoveryAmount}</td>
<td>${t.currency}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.code}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer suppression?')"><button class="delete">❌</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️</button></a>
${t.retired?'':`<form method="post" action="/transferts/retirer" style="display:inline;">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select>
<button class="retire">Retirer</button></form>`}
</td>
</tr>`).join('')}
</tbody>
</table>

<script>
const ctxD = document.getElementById('chartDevise').getContext('2d');
new Chart(ctxD,{type:'pie',data:{labels:['GNF','EUR','USD','XOF'],datasets:[{data:[${devises.GNF},${devises.EUR},${devises.USD},${devises.XOF}],backgroundColor:['#28a745','#17a2b8','#ffc107','#dc3545']}]}});

const ctxDest = document.getElementById('chartDest').getContext('2d');
new Chart(ctxDest,{type:'bar',data:{labels: ${JSON.stringify(Object.keys(destinations))}, datasets:[{label:'Nombre de transferts',data:${JSON.stringify(Object.values(destinations))},backgroundColor:'#2c7be5'}]}});

const searchInput = document.getElementById('searchPhone');
searchInput.addEventListener('input', function(){
  const val = this.value.toLowerCase();
  const rows = document.querySelectorAll('#transfertsTable tbody tr');
  rows.forEach(r=>{
    const phone = r.children[2].textContent.toLowerCase();
    const receiverPhone = r.children[9].textContent.toLowerCase();
    const code = r.children[10].textContent.toLowerCase();
    r.style.display = (phone.includes(val)||receiverPhone.includes(val)||code.includes(val))?'':'none';
  });
});
</script>
</div></body></html>
  `);
});

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
