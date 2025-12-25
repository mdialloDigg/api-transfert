/******************************************************************
 * APP TRANSFERT – DASHBOARD ORANGE LIVE AVEC NOTIFICATIONS SONORES
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-live-sound',
  resave: false,
  saveUninitialized: true
}));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

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

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

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

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

app.get('/login',(req,res)=>{
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{margin:0;font-family:Arial;background:#1e1e2f;color:#fff;text-align:center;padding-top:80px;}
form{background:#2c2c3e;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.4);}
input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #444;background:#1e1e2f;color:#fff;}
button{background:#ff7f50;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
button:hover{background:#ff5722;box-shadow:0 0 15px #ff7f50;}
</style></head><body>
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form></body></html>`);
});

app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    await new Auth({ username, password: hashed }).save();
    req.session.user = username;
    return res.redirect('/dashboard');
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = username;
  res.redirect('/dashboard');
});

// ================= DASHBOARD LIVE AVEC TOAST + SON =================
app.get('/dashboard', requireLogin, (req,res)=>{
res.send(`<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard Orange Live Notification Sonore</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
body{font-family:'Segoe UI',sans-serif;background:#fff3e0;color:#000;margin:0;padding:15px;}
h1,h2,h3{color:#ff5722;text-align:center;margin:10px 0;}
.stats{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:20px;}
.card{background:#ffcc99;border-radius:12px;padding:15px;box-shadow:0 6px 16px rgba(0,0,0,0.3);transition:0.3s, box-shadow 0.5s;}
.card:hover{transform:translateY(-3px) scale(1.02);}
.card.flash{animation:flashCard 1s ease;}
@keyframes flashCard{0%{box-shadow:0 0 0 #ff5722;}50%{box-shadow:0 0 20px #ffd700;}100%{box-shadow:0 0 0 #ff5722;}}
.card .status{padding:3px 6px;border-radius:6px;display:inline-block;margin-top:5px;}
.status.retiré{background:rgba(220,53,69,0.8);color:#fff;}
.status.non{background:rgba(40,167,69,0.8);color:#fff;}
.status.glow{box-shadow:0 0 10px #ffd700,0 0 20px #ffd700,0 0 30px #ffd700;}
.dashboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px;}
form.inline{display:inline;}
a{text-decoration:none;color:#ff5722;}
a:hover{text-decoration:underline;}
canvas{background:#fff3e0;border-radius:12px;padding:10px;margin-top:20px;}
.search-sort{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:15px;}
input,select{padding:6px;border-radius:6px;border:1px solid #ffb74d;background:#ffe0b2;color:#000;}
.retired-row{background:rgba(220,53,69,0.2);}
.toast-container{position:fixed;top:10px;right:10px;z-index:9999;}
.toast{background:#ff5722;color:#fff;padding:12px 18px;margin-top:10px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:fadeInOut 4s forwards;}
@keyframes fadeInOut{0%{opacity:0;transform:translateX(100%);}10%{opacity:1;transform:translateX(0);}90%{opacity:1;transform:translateX(0);}100%{opacity:0;transform:translateX(100%);}}
</style>
</head>
<body>
<h1>📊 Dashboard Orange Live</h1>
<div style="text-align:center;margin-bottom:15px;">
<a href="/menu">⬅ Menu</a> | <a href="/transferts/form">➕ Nouveau</a> | <a href="/transferts/pdf">📄 PDF</a>
</div>

<div class="search-sort">
<input type="text" id="searchPhone" placeholder="Téléphone">
<input type="text" id="searchCode" placeholder="Code">
<input type="text" id="searchName" placeholder="Nom destinataire">
<select id="sort">
<option value="">Tri</option>
<option value="amount">Montant</option>
<option value="status">Statut retrait</option>
</select>
<button onclick="loadData()">Filtrer / Trier</button>
</div>

<h2>Dernier Transfert</h2>
<div class="stats" id="lastTransfert"></div>
<div class="dashboard" id="cardsContainer"></div>

<h2>Graphiques Animés</h2>
<canvas id="barChart" height="50"></canvas>
<canvas id="pieChart" height="50"></canvas>

<div class="toast-container" id="toastContainer"></div>

<audio id="notifSound" src="https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg" preload="auto"></audio>

<script>
let barChart, pieChart;
let previousCodes = new Set();
let previousRetired = new Set();
const sound = document.getElementById('notifSound');

function showToast(message, playSound=true){
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = message;
  container.appendChild(toast);
  if(playSound){ sound.play().catch(()=>{}); }
  setTimeout(()=>{toast.remove()},4000);
}

async function loadData(){
  const phone = document.getElementById('searchPhone').value;
  const code = document.getElementById('searchCode').value;
  const name = document.getElementById('searchName').value;
  const sort = document.getElementById('sort').value;
  const res = await fetch('/dashboard/data?searchPhone='+phone+'&searchCode='+code+'&searchName='+name+'&sort='+sort);
  const data = await res.json();
  renderDashboard(data);
}

function renderDashboard(data){
  const lastDiv = document.getElementById('lastTransfert');
  lastDiv.innerHTML = '';
  if(data.lastTransfert){
    const t = data.lastTransfert;
    lastDiv.innerHTML = '<div class="card status glow">'+
      '<h3>Code: '+t.code+'</h3>'+
      '<p><strong>Expéditeur:</strong> '+t.senderFirstName+' '+t.senderLastName+'</p>'+
      '<p><strong>Destinataire:</strong> '+t.receiverFirstName+' '+t.receiverLastName+'</p>'+
      '<p><strong>Montant:</strong> '+t.amount+' '+t.currency+'</p>'+
      '<span class="status '+(t.retired?'retiré':'non')+'">'+(t.retired?'Retiré':'Non retiré')+'</span></div>';
  }

  const cards = document.getElementById('cardsContainer');
  cards.innerHTML = '';
  data.transferts.forEach(t=>{
    let hist = t.retraitHistory.map(h=>h.date+' ('+h.mode+')').join('<br>') || '-';
    let flashClass = '';
    if(!previousCodes.has(t.code)){ flashClass = 'flash'; previousCodes.add(t.code); showToast('Nouveau transfert: '+t.code); }
    if(t.retired && !previousRetired.has(t.code)){ showToast('Transfert retiré: '+t.code); previousRetired.add(t.code); }
    cards.innerHTML += '<div class="card '+(t.retired?'retired-row ':'')+flashClass+'">'+
      '<h3>Code: '+t.code+'</h3>'+
      '<p><strong>Type:</strong> '+t.userType+'</p>'+
      '<p><strong>Expéditeur:</strong> '+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')</p>'+
      '<p><strong>Destinataire:</strong> '+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')</p>'+
      '<p><strong>Montant:</strong> '+t.amount+' '+t.currency+' | <strong>Frais:</strong> '+t.fees+' | <strong>Reçu:</strong> '+t.recoveryAmount+'</p>'+
      '<p><strong>Historique retrait:</strong><br>'+hist+'</p>'+
      '<span class="status '+(t.retired?'retiré':'non')+'">'+(t.retired?'Retiré':'Non retiré')+'</span>'+
      '</div>';
  });

  const destinations = data.destinations;
  const amounts = destinations.map(d=>data.statsByDest[d].totalAmount);
  const retiredCount = data.transferts.filter(t=>t.retired).length;
  const nonRetiredCount = data.transferts.length - retiredCount;

  if(barChart) barChart.destroy();
  const ctx = document.getElementById('barChart').getContext('2d');
  barChart = new Chart(ctx,{
    type:'bar',
    data:{labels:destinations,datasets:[{label:'Montants',data:amounts,backgroundColor:'#ff5722'}]},
    options:{responsive:true,animation:{duration:1000,easing:'easeOutBounce'},plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}
  });

  if(pieChart) pieChart.destroy();
  const ctx2 = document.getElementById('pieChart').getContext('2d');
  pieChart = new Chart(ctx2,{
    type:'pie',
    data:{labels:['Retirés','Non retirés'],datasets:[{data:[retiredCount,nonRetiredCount],backgroundColor:['#dc3545','#28a745']}]},
    options:{responsive:true,animation:{duration:1000,easing:'easeOutBounce'}}
  });
}

loadData();
setInterval(loadData,5000);
</script>
</body></html>`);
});

app.get('/dashboard/data', requireLogin, async(req,res)=>{
  let transferts = await Transfert.find().sort({destinationLocation:1, createdAt:-1});
  const { searchPhone='', searchCode='', searchName='', sort='' } = req.query;
  if(searchPhone) transferts = transferts.filter(t=>t.senderPhone.includes(searchPhone)||t.receiverPhone.includes(searchPhone));
  if(searchCode) transferts = transferts.filter(t=>t.code.includes(searchCode));
  if(searchName) transferts = transferts.filter(t=>t.receiverFirstName.toLowerCase().includes(searchName.toLowerCase()) || t.receiverLastName.toLowerCase().includes(searchName.toLowerCase()));
  if(sort==='amount') transferts = transferts.sort((a,b)=>b.amount - a.amount);
  if(sort==='status') transferts = transferts.sort((a,b)=>b.retired - a.retired);
  const destinations = [...new Set(transferts.map(t=>t.destinationLocation))];
  let statsByDest = {};
  destinations.forEach(dest=>{ const list = transferts.filter(t=>t.destinationLocation===dest); statsByDest[dest]={totalAmount:list.reduce((a,b)=>a+b.amount,0)}; });
  res.json({transferts,lastTransfert:transferts[0]||null,destinations,statsByDest});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
