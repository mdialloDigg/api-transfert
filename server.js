/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const PDFDocument = require('pdfkit');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => console.error(err));

/* ================= SCHEMA ================= */
const userSchema = new mongoose.Schema({
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  amount: Number,
  fees: Number,
  feePercent: Number,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  recoveryAmount: Number,
  recoveryMode: String,
  code: String,
  status: { type: String, default: 'actif' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

/* ================= ROOT ================= */
app.get('/', (req, res) => {
  res.send('🚀 API Transfert en ligne');
});

/* ================= LOGIN ================= */
app.get('/login', (req, res) => {
  res.send(`
  <html><body style="font-family:Arial;text-align:center;padding-top:80px">
  <h2>🔐 Accès sécurisé</h2>
  <form method="post">
    <input type="password" name="code" placeholder="Code accès" required><br><br>
    <button>Connexion</button>
  </form>
  </body></html>
  `);
});

app.post('/login', (req, res) => {
  if (req.body.code === '123') {
    req.session.formAccess = true;
    return res.redirect('/users/choice');
  }
  res.send('❌ Code incorrect');
});

/* ================= USERS ================= */
app.get('/users', (req, res) => {
  if (!req.session.formAccess) return res.redirect('/login');
  res.redirect('/users/choice');
});

/* ================= CHOICE ================= */
app.get('/users/choice', (req, res) => {
  if (!req.session.formAccess) return res.redirect('/login');

  res.send(`
  <html>
  <body style="font-family:Arial;text-align:center;padding-top:50px;background:#eef2f7">
    <h2>📋 Gestion des transferts</h2>
    <a href="/users/lookup?mode=new"><button>💾 Nouveau transfert</button></a><br><br>
    <a href="/users/lookup?mode=edit"><button>✏️ Modifier transfert</button></a><br><br>
    <a href="/users/lookup?mode=delete"><button>❌ Supprimer transfert</button></a><br><br>
    <a href="/users/all"><button>📊 Liste des transferts</button></a><br><br>
    <a href="/logout"><button>🚪 Déconnexion</button></a>
  </body>
  </html>
  `);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup', (req, res) => {
  if (!req.session.formAccess) return res.redirect('/login');

  req.session.choiceMode = req.query.mode;

  res.send(`
  <html><body style="text-align:center;padding-top:80px">
    <h3>📞 Téléphone expéditeur</h3>
    <form method="post">
      <input name="phone" required><br><br>
      <button>Continuer</button>
    </form>
  </body></html>
  `);
});

app.post('/users/lookup', async (req, res) => {
  const u = await User.findOne({ senderPhone: req.body.phone }).sort({ createdAt: -1 });
  req.session.prefill = u || { senderPhone: req.body.phone };
  req.session.editId = u ? u._id : null;

  if (req.session.choiceMode === 'delete' && u) {
    await User.findByIdAndDelete(u._id);
    return res.send(`Supprimé <a href="/users/choice">Retour</a>`);
  }

  res.redirect('/users/form');
});

/* ================= FORMULAIRE COMPLET RESTAURÉ ================= */
app.get('/users/form', (req, res) => {
  if (!req.session.formAccess) return res.redirect('/login');

  const u = req.session.prefill || {};
  const isEdit = !!req.session.editId;
  const locations = ['France','Labé','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

  res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width">
<style>
body{font-family:Arial;background:#dde5f0}
form{background:#fff;max-width:950px;margin:20px auto;padding:15px;border-radius:8px}
.container{display:flex;flex-wrap:wrap;gap:15px}
.box{flex:1;min-width:250px;padding:10px;border-radius:6px}
.origin{background:#e3f0ff}
.dest{background:#ffe3e3}
input,select,button{width:100%;padding:9px;margin-top:8px}
button{border:none;color:white;font-size:15px;border-radius:5px;cursor:pointer}
#save{background:#007bff} #cancel{background:#dc3545}
</style>
</head>
<body>

<form id="form">
<h3 style="text-align:center">${isEdit?'✏️ Modifier':'💸 Nouveau'} transfert</h3>

<div class="container">
<div class="box origin">
<h4>📤 Expéditeur</h4>
<input id="senderFirstName" value="${u.senderFirstName||''}" placeholder="Prénom">
<input id="senderLastName" value="${u.senderLastName||''}" placeholder="Nom">
<input id="senderPhone" value="${u.senderPhone||''}" placeholder="Téléphone">
<select id="originLocation">
${locations.map(v=>`<option ${u.originLocation===v?'selected':''}>${v}</option>`).join('')}
</select>
<input id="amount" type="number" value="${u.amount||''}" placeholder="Montant">
<input id="fees" type="number" value="${u.fees||''}" placeholder="Frais">
</div>

<div class="box dest">
<h4>📥 Destinataire</h4>
<input id="receiverFirstName" value="${u.receiverFirstName||''}" placeholder="Prénom">
<input id="receiverLastName" value="${u.receiverLastName||''}" placeholder="Nom">
<input id="receiverPhone" value="${u.receiverPhone||''}" placeholder="Téléphone">
<select id="destinationLocation">
${locations.map(v=>`<option ${u.destinationLocation===v?'selected':''}>${v}</option>`).join('')}
</select>
<input id="recoveryAmount" value="${u.recoveryAmount||''}" placeholder="Montant reçu" readonly>
</div>
</div>

<button id="save">${isEdit?'Mettre à jour':'Enregistrer'}</button>
${isEdit?'<button type="button" id="cancel" onclick="cancel()">Supprimer</button>':''}
<p id="msg"></p>
</form>

<script>
amount.oninput = fees.oninput = ()=>{
  recoveryAmount.value = (+amount.value||0) - (+fees.value||0);
};

form.onsubmit = async e=>{
  e.preventDefault();
  const r = await fetch('${isEdit?'/users/update':'/users'}',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      senderFirstName:senderFirstName.value,
      senderLastName:senderLastName.value,
      senderPhone:senderPhone.value,
      originLocation:originLocation.value,
      amount:+amount.value,
      fees:+fees.value,
      receiverFirstName:receiverFirstName.value,
      receiverLastName:receiverLastName.value,
      receiverPhone:receiverPhone.value,
      destinationLocation:destinationLocation.value,
      recoveryAmount:+recoveryAmount.value
    })
  });
  msg.innerText=(await r.json()).message;
};

function cancel(){
  if(confirm('Supprimer ?')){
    fetch('/users/delete',{method:'POST'}).then(()=>location.href='/users/choice');
  }
}
</script>

</body></html>`);
});

/* ================= CRUD ================= */
app.post('/users', async (req, res) => {
  const code = Math.floor(100000 + Math.random()*900000).toString();
  await new User({...req.body, code}).save();
  res.json({ message: '✅ Transfert enregistré | Code ' + code });
});

app.post('/users/update', async (req, res) => {
  await User.findByIdAndUpdate(req.session.editId, req.body);
  res.json({ message: '✏️ Transfert mis à jour' });
});

app.post('/users/delete', async (req, res) => {
  await User.findByIdAndDelete(req.session.editId);
  res.json({ message: '❌ Supprimé' });
});

/* ================= LISTE + RETRAIT + PDF ================= */
/* (identique à avant + modal améliorée) */

app.get('/users/all', async (req, res) => {
  if (!req.session.formAccess) return res.redirect('/login');

  const users = await User.find().sort({ destinationLocation:1, createdAt:1 });
  let html = '<html><body><h2 style="text-align:center">📊 Liste des transferts</h2>';

  users.forEach(u=>{
    html+=`
    <div style="border:1px solid #ccc;padding:8px;margin:6px">
      ${u.senderPhone} → ${u.receiverPhone} | ${u.amount} | ${u.retired?'🟧 Retiré':'<button onclick="retirer(\\''+u._id+'\\')">💰 Retirer</button>'}
    </div>`;
  });

  html+=`
  <script>
  function retirer(id){
    const m=document.createElement('div');
    m.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
    m.innerHTML=\`
      <div style="background:#fff;padding:25px;border-radius:10px;width:350px">
      <h3>💰 Retrait</h3>
      <select id="mode" style="width:100%;padding:10px">
        <option>Espèces</option>
        <option>Orange Money</option>
        <option>Produit</option>
        <option>Service</option>
      </select><br><br>
      <button onclick="ok()">Valider</button>
      </div>\`;
    document.body.appendChild(m);

    window.ok=async()=>{
      await fetch('/users/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:mode.value})});
      location.reload();
    }
  }
  </script>
  </body></html>`;

  res.send(html);
});

app.post('/users/retirer', async (req, res) => {
  const u = await User.findById(req.body.id);
  u.retired = true;
  u.recoveryMode = req.body.mode;
  u.retraitHistory.push({date:new Date(), mode:req.body.mode});
  await u.save();
  res.json({message:'OK'});
});

/* ================= PDF ================= */
app.get('/users/export/pdf', async (req,res)=>{
  const users = await User.find();
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts',{align:'center'}).moveDown();
  users.forEach(u=>{
    doc.text(`${u.senderPhone} → ${u.receiverPhone} | ${u.amount}`);
    doc.moveDown();
  });
  doc.end();
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Serveur Render prêt');
});
