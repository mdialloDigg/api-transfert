/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET MODERNE
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

// ================= DASHBOARD MODERNE =================
app.get('/menu', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1});
  const codeAuto = await generateUniqueCode();

  res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;font-family:Arial;background:#f4f6f8;}
.sidebar{width:220px;background:#2c7be5;color:white;height:100vh;position:fixed;display:flex;flex-direction:column;transition:0.3s;}
.sidebar h2{text-align:center;padding:20px 0;border-bottom:1px solid rgba(255,255,255,0.3);}
.sidebar a{color:white;text-decoration:none;padding:15px 20px;border-bottom:1px solid rgba(255,255,255,0.1);}
.sidebar a:hover{background:#1a5bb8;}
.main{margin-left:220px;padding:20px;transition:0.3s;}
@media(max-width:768px){.sidebar{width:60px;} .main{margin-left:60px;}}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-bottom:20px;}
.card{background:white;padding:15px;border-radius:12px;box-shadow:0 6px 15px rgba(0,0,0,0.1);text-align:center;}
.card h3{margin:0;color:#2c7be5;}
form#transfertForm{background:white;padding:15px;border-radius:12px;box-shadow:0 6px 15px rgba(0,0,0,0.1);margin-bottom:20px;display:flex;flex-wrap:wrap;gap:10px;}
form#transfertForm input, form#transfertForm select{flex:1;min-width:150px;padding:10px;border-radius:6px;border:1px solid #ccc;}
form#transfertForm button{flex-basis:100%;padding:12px;background:#2eb85c;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}
form#transfertForm button:hover{background:#218838;}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 6px 15px rgba(0,0,0,0.1);display:block;overflow-x:auto;}
th,td{padding:10px;text-align:center;border-bottom:1px solid #eee;font-size:14px;white-space:nowrap;}
th{background:#2c7be5;color:white;position:sticky;top:0;}
tr:hover{background:#f1f5f9;}
button{padding:6px 10px;margin:2px;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}
button.delete{background:#dc3545;color:white;} button.print{background:#17a2b8;color:white;} button.retire{background:#28a745;color:white;}
input#searchPhone{width:100%;padding:10px;margin-bottom:10px;border-radius:6px;border:1px solid #ccc;}
</style>
</head>
<body>

<div class="sidebar">
<h2>💰 Transferts</h2>
<a href="#form">➕ Nouveau / Modifier</a>
<a href="#list">📋 Liste</a>
<a href="#" id="btnPDFGlobal">📄 PDF Global</a>
<a href="/logout">🚪 Déconnexion</a>
</div>

<div class="main">
<h2 id="form">➕ Nouveau / Modifier Transfert</h2>
<form id="transfertForm" method="post" action="/transferts/save">
<select name="userType"><option>Client</option><option>Distributeur</option><option>Administrateur</option><option>Agence de transfert</option></select>
<select name="currency"><option>GNF</option><option>EUR</option><option>USD</option><option>XOF</option></select>
<input name="senderFirstName" placeholder="Prénom" required>
<input name="senderLastName" placeholder="Nom" required>
<input name="senderPhone" placeholder="Téléphone" required>
<select name="originLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select>
<input name="receiverFirstName" placeholder="Prénom" required>
<input name="receiverLastName" placeholder="Nom" required>
<input name="receiverPhone" placeholder="Téléphone" required>
<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`).join('')}</select>
<input type="number" name="amount" placeholder="Montant" id="amountField" required>
<input type="number" name="fees" placeholder="Frais" id="feesField" required>
<input type="text" name="recoveryAmount" id="recoveryField" placeholder="Montant à recevoir" readonly>
<input type="text" name="code" value="${codeAuto}" readonly>
<button type="submit">Enregistrer</button>
</form>

<h2 id="list">Liste des transferts</h2>
<input type="text" id="searchPhone" placeholder="🔍 Rechercher par téléphone ou code">
<table id="transfertsTable">
<thead>
<tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Destinataire</th><th>Tél</th><th>Code</th><th>Statut</th><th>Actions</th></tr>
</thead>
<tbody>
${transferts.map(t=>`
<tr data-id="${t._id}">
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
<button class="editBtn">✏️</button>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer suppression?')"><button class="delete">❌</button></a>
<form method="post" action="/transferts/retirer" style="display:inline;">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select>
<button class="retire">Retirer</button></form>
<button class="printTicket" data-id="${t._id}">🖨️ Ticket</button>
</td>
</tr>`).join('')}
</tbody>
</table>

<h2>📊 Statistiques Montants</h2>
<canvas id="statsChart" style="max-width:600px;margin:auto;"></canvas>

<h2>📈 Statut des transferts</h2>
<canvas id="statusChart" style="max-width:400px;margin:auto;"></canvas>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
// Recherche
const searchInput = document.getElementById('searchPhone');
searchInput.addEventListener('input', function(){
  const val = this.value.toLowerCase();
  document.querySelectorAll('#transfertsTable tbody tr').forEach(r=>{
    const phone = r.children[2].textContent.toLowerCase();
    const receiverPhone = r.children[9].textContent.toLowerCase();
    const code = r.children[10].textContent.toLowerCase();
    r.style.display = (phone.includes(val)||receiverPhone.includes(val)||code.includes(val))?'':'none';
  });
});

// Formulaire
const form = document.getElementById('transfertForm');
const amountField = document.getElementById('amountField');
const feesField = document.getElementById('feesField');
const recoveryField = document.getElementById('recoveryField');
function updateRecovery(){ recoveryField.value=(parseFloat(amountField.value||0)-parseFloat(feesField.value||0)).toFixed(2); }
amountField.addEventListener('input',updateRecovery);
feesField.addEventListener('input',updateRecovery);
updateRecovery();

// Edition
document.querySelectorAll('.editBtn').forEach(btn=>{
  btn.addEventListener('click', function(){
    const tr = this.closest('tr');
    form.action = '/transferts/save?id=' + tr.dataset.id;
    form.userType.value = tr.children[0].textContent;
    form.senderFirstName.value = tr.children[1].textContent.split(' ')[0];
    form.senderLastName.value = tr.children[1].textContent.split(' ')[1] || '';
    form.senderPhone.value = tr.children[2].textContent;
    form.originLocation.value = tr.children[3].textContent;
    form.amount.value = tr.children[4].textContent;
    form.fees.value = tr.children[5].textContent;
    updateRecovery();
    form.receiverFirstName.value = tr.children[8].textContent.split(' ')[0];
    form.receiverLastName.value = tr.children[8].textContent.split(' ')[1] || '';
    form.receiverPhone.value = tr.children[9].textContent;
    form.destinationLocation.value = tr.children[7].textContent;
    form.currency.value = tr.children[7].textContent;
  });
});

// PDF global
document.getElementById('btnPDFGlobal').addEventListener('click', function(e){
    e.preventDefault();
    window.open('/transferts/pdf','_blank');
});

// Ticket individuel
document.querySelectorAll('.printTicket').forEach(btn=>{
    btn.addEventListener('click', function(){
        const id = this.dataset.id;
        window.open('/transferts/print/' + id,'_blank');
    });
});

// Graphique Montants par destination
const ctx = document.getElementById('statsChart').getContext('2d');
let totalMontant = 0, totalFrais = 0, totalRecu = 0;
let destinations = {};
document.querySelectorAll('#transfertsTable tbody tr').forEach(tr=>{
  const montant = parseFloat(tr.children[4].textContent) || 0;
  const frais = parseFloat(tr.children[5].textContent) || 0;
  const recu = parseFloat(tr.children[6].textContent) || 0;
  const dest = tr.children[7].textContent;
  totalMontant += montant;
  totalFrais += frais;
  totalRecu += recu;
  destinations[dest] = (destinations[dest]||0) + montant;
});
new Chart(ctx, {
  type: 'bar',
  data: { labels:Object.keys(destinations), datasets:[{label:'Montant par destination',data:Object.values(destinations),backgroundColor:'#2c7be5'}] },
  options: { responsive:true, plugins:{ legend:{display:false}, title:{display:true,text:\`Totaux → Montant: ${totalMontant} | Frais: ${totalFrais} | Reçu: ${totalRecu}\`} }, scales:{ y:{beginAtZero:true} } }
});

// Graphique Statut Retiré / Non retiré
const ctxStatus = document.getElementById('statusChart').getContext('2d');
let retiredCount=0, notRetiredCount=0;
document.querySelectorAll('#transfertsTable tbody tr').forEach(tr=>{
  if(tr.children[11].textContent.includes('Retiré')) retiredCount++;
  else notRetiredCount++;
});
new Chart(ctxStatus, {
  type: 'doughnut',
  data: { labels:['Retiré','Non retiré'], datasets:[{data:[retiredCount,notRetiredCount],backgroundColor:['#28a745','#dc3545']}] },
  options:{ responsive:true, plugins:{ legend:{position:'bottom'}, title:{display:true,text:'Répartition des transferts'} } }
});
</script>
</div></body></html>
  `);
});

// ================= SAVE / EDIT =================
app.post('/transferts/save', requireLogin, async(req,res)=>{
  try{
    const amount = Number(req.body.amount||0);
    const fees = Number(req.body.fees||0);
    const recoveryAmount = amount - fees;
    if(req.query.id){
      await Transfert.findByIdAndUpdate(req.query.id,{...req.body,amount,fees,recoveryAmount});
    }else{
      const code = req.body.code || await generateUniqueCode();
      await new Transfert({...req.body,amount,fees,recoveryAmount,retraitHistory:[],code}).save();
    }
    res.redirect('/menu');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      recoveryMode:req.body.mode,
      $push:{retraitHistory:{date:new Date(),mode:req.body.mode}}
    });
    res.redirect('/menu');
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= DELETE =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/menu');
});

// ================= TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial;text-align:center;padding:20px;} .ticket{border:1px dashed #333;padding:15px;width:300px;margin:auto;} button{margin-top:10px;padding:8px 15px;}</style></head>
<body><div class="ticket"><h3>💰 Transfert</h3>
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
<button onclick="window.print()">🖨️ Imprimer</button></div></body></html>`);
});

// ================= PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  try{
    const list = await Transfert.find().sort({destinationLocation:1});
    const doc = new PDFDocument({margin:30, size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'}); doc.moveDown();
    let groupedPDF={};
    list.forEach(t=>{ if(!groupedPDF[t.destinationLocation]) groupedPDF[t.destinationLocation]=[]; groupedPDF[t.destinationLocation].push(t); });
    let totalA=0,totalF=0,totalR=0;
    for(let dest in groupedPDF){
      let subA=0,subF=0,subR=0;
      doc.fontSize(14).fillColor('#2c7be5').text(`Destination: ${dest}`);
      groupedPDF[dest].forEach(t=>{
        subA+=t.amount; subF+=t.fees; subR+=t.recoveryAmount;
        totalA+=t.amount; totalF+=t.fees; totalR+=t.recoveryAmount;
        doc.fontSize(10).fillColor('black')
          .text(`Type: ${t.userType} | Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
          .text(`Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} ${t.currency} | Reçu: ${t.recoveryAmount} ${t.currency} | Statut: ${t.retired?'Retiré':'Non retiré'} | Code: ${t.code}`);
        if(t.retraitHistory) t.retraitHistory.forEach(h=>doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`));
        doc.moveDown(0.5);
      });
      doc.fontSize(12).text(`Sous-total ${dest} → Montant: ${subA} | Frais: ${subF} | Reçu: ${subR}`).moveDown();
    }
    doc.fontSize(14).fillColor('black').text(`TOTAL GLOBAL → Montant: ${totalA} | Frais: ${totalF} | Reçu: ${totalR}`,{align:'center'});
    doc.end();
  }catch(err){ console.error(err); res.status(500).send(err.message);}
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
