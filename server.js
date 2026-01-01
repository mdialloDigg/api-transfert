/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN 100% MÉMOIRE (Render)
 ******************************************************************/

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= MEMORY DATABASE =================
const memory = { transferts: [], auth: [] };

// ================= UTIL =================
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = memory.transferts.find(t => t.code === code);
  }
  return code;
}

// Helpers mémoire
async function findTransferts(){ return memory.transferts; }
async function findTransfertByCode(code){ return memory.transferts.find(t=>t.code===code); }
async function saveTransfert(obj){ obj._id = String(Date.now()); memory.transferts.push(obj); }
async function updateTransfert(id,obj){ const idx = memory.transferts.findIndex(t=>t._id==id); if(idx!==-1) memory.transferts[idx]={...memory.transferts[idx], ...obj}; }
async function deleteTransfert(id){ memory.transferts = memory.transferts.filter(t=>t._id!=id); }

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ================= CONFIG =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><body>
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required>
      <input type="password" name="password" placeholder="Mot de passe" required>
      <button>Se connecter</button>
    </form>
  </body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = memory.auth.find(u=>u.username===username);
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = { username, password:hashed, role:'agent', _id:String(Date.now()) };
    memory.auth.push(user);
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t = req.query.code ? await findTransfertByCode(req.query.code) : null;
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||'';
  const status = req.query.status||'all';

  res.send(`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
    .container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
    h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
    form{display:grid;gap:15px;}
    label{font-weight:bold;}
    input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
    input[readonly]{background:#e9ecef;}
    button{padding:15px;background:#ff8c42;color:white;font-weight:bold;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
    button:hover{background:#e67300;}
  </style>
  </head><body>
  <div class="container">
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <label>Type</label><select name="userType">
        <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
        <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
        <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
        <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
      </select>
      <label>Expéditeur - Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required>
      <label>Expéditeur - Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required>
      <label>Expéditeur - Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required>
      <label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select>
      <label>Destinataire - Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required>
      <label>Destinataire - Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required>
      <label>Destinataire - Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required>
      <label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select>
      <label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}">
      <label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}">
      <label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}">
      <label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
      <label>Code</label><input name="code" value="${code}" readonly>
      <label>Mode de retrait</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/transferts/list?search=${encodeURIComponent(search)}&status=${status}">⬅ Retour liste</a>
    <script>
      const amountField=document.getElementById('amount');
      const feesField=document.getElementById('fees');
      const recoveryField=document.getElementById('recoveryAmount');
      function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
      amountField.addEventListener('input',updateRecovery);
      feesField.addEventListener('input',updateRecovery);
      updateRecovery();
    </script>
  </div>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await findTransfertByCode(code);

  const transfertObj = {...req.body, amount, fees, recoveryAmount, retraitHistory:[], retired:false, code, createdAt:new Date()};
  if(existing) await updateTransfert(existing._id, transfertObj);
  else await saveTransfert(transfertObj);

  res.redirect(`/transferts/list`);
});

// ================= LISTE AVEC AJAX, FILTRES & PAGINATION =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  let transferts = await findTransferts();
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    const match = [t.code,t.senderFirstName,t.senderLastName,t.senderPhone,t.receiverFirstName,t.receiverLastName,t.receiverPhone]
      .some(f => f && f.toLowerCase().includes(s));
    if(!match) return false;
    if(status==='retire') return t.retired;
    if(status==='non') return !t.retired;
    return true;
  });

  const limit=20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit, page*limit);

  // Totaux
  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // HTML simplifié (AJAX reste possible)
  let html = `<html><body>
    <h2>📋 Liste des transferts</h2>
    <a href="/transferts/form">➕ Nouveau</a>
    <table border="1">
      <tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th></tr>`;
  paginated.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
    </tr>`;
  });
  html+='</table></body></html>';
  res.send(html);
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
