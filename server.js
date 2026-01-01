const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());
app.use(session({secret:'secret',resave:false,saveUninitialized:true}));

mongoose.connect('mongodb://127.0.0.1:27017/transferts', {useNewUrlParser:true,useUnifiedTopology:true});

const TransfertSchema = new mongoose.Schema({
  code:String, userType:String,
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:String, recoveryMode:String,
  retired:{type:Boolean,default:false}, createdAt:{type:Date,default:Date.now}, retraitHistory:Array
});
const Transfert = mongoose.model('Transfert',TransfertSchema);

const users = {
  a:{username:'a',password:'123',permissions:{ecriture:true,modification:true,suppression:true,retrait:true,imprimer:true}},
  admin2:{username:'admin2',password:'123',permissions:{ecriture:true,modification:true,suppression:true,retrait:true,imprimer:true}}
};

const locations=['Paris','Lyon','Marseille','Tunis','Casablanca'];
const currencies=['EUR','USD','TND','MAD'];
const retraitModes=['Espèces','Virement'];

function requireLogin(req,res,next){if(!req.session.user)return res.redirect('/login');next();}
async function generateUniqueCode(){return 'TR'+Date.now();}

// ---------- LOGIN ----------
app.get('/login',(req,res)=>{res.send(`<html><meta name="viewport" content="width=device-width, initial-scale=1"><body>
<h2>Login</h2><form method="post">
<input name="username" placeholder="Utilisateur" required><br><input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button></form></body></html>`);});
app.post('/login',(req,res)=>{
  const u=users[req.body.username];
  if(u && u.password===req.body.password){req.session.user=u;res.redirect('/transferts/list');}
  else res.send('Utilisateur ou mot de passe incorrect');});
app.get('/logout',(req,res)=>{req.session.destroy();res.redirect('/login');});

// ---------- TRANSFERT FORM ----------
app.get('/transferts/form',requireLogin,async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t=await Transfert.findOne({code:req.query.code});
  const code=t?t.code:await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
  .container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
  h2{text-align:center;color:#ff8c42;margin-bottom:20px;}
  form{display:grid;gap:15px;}
  label{font-weight:bold;}
  input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
  input[readonly]{background:#e9ecef;}
  button{padding:15px;background:#ff8c42;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
  button:hover{background:#e67300;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;}
  a{display:inline-block;margin-top:15px;color:#ff8c42;text-decoration:none;font-weight:bold;}
  </style>
  </head><body>
  <div class="container">
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <div class="grid">
        <div><label>Type de personne</label>
          <select name="userType">
            <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
            <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
            <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
            <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
          </select>
        </div>
        <div><label>Code transfert</label><input name="code" readonly value="${code}"></div>
      </div>
      <div class="grid">
        <div><label>Expéditeur Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
        <div><label>Expéditeur Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
        <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
        <div><label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="grid">
        <div><label>Destinataire Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
        <div><label>Destinataire Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
        <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
        <div><label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="grid">
        <div><label>Montant</label><input type="number" name="amount" id="amount" required value="${t?t.amount:''}"></div>
        <div><label>Frais</label><input type="number" name="fees" id="fees" required value="${t?t.fees:''}"></div>
        <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
        <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
      </div>
      <div><label>Mode de retrait</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select></div>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/transferts/list">⬅ Retour liste</a>
  </div>
  <script>
    const amount=document.getElementById('amount'), fees=document.getElementById('fees'), recovery=document.getElementById('recoveryAmount');
    function updateRecovery(){recovery.value=(parseFloat(amount.value)||0)-(parseFloat(fees.value)||0);}
    amount.addEventListener('input',updateRecovery); fees.addEventListener('input',updateRecovery); updateRecovery();
  </script></body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount=Number(req.body.amount||0);
  const fees=Number(req.body.fees||0);
  const recoveryAmount=amount-fees;
  const code=req.body.code || await generateUniqueCode();
  let existing=await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ---------- LISTE TRANSFERT ----------
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const search=req.query.search||'';
  const status=req.query.status||'all';
  let transferts=await Transfert.find().sort({createdAt:-1});
  const s=search.toLowerCase();
  transferts=transferts.filter(t=>{
    return t.code.toLowerCase().includes(s) || t.senderFirstName.toLowerCase().includes(s) || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s) || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s) || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts=transferts.filter(t=>t.retired);
  else if(status==='non') transferts=transferts.filter(t=>!t.retired);

  let totalAmount=transferts.reduce((sum,t)=>sum+(t.amount||0),0);
  let totalFees=transferts.reduce((sum,t)=>sum+(t.fees||0),0);
  let totalRecovery=transferts.reduce((sum,t)=>sum+(t.recoveryAmount||0),0);

  // Totaux par destination et devise
  let totalsByDest = {};
  let totalsByCurrency = {};
  transferts.forEach(t=>{
    if(!totalsByDest[t.destinationLocation]) totalsByDest[t.destinationLocation]={amount:0,fees:0,recovery:0};
    totalsByDest[t.destinationLocation].amount+=t.amount||0;
    totalsByDest[t.destinationLocation].fees+=t.fees||0;
    totalsByDest[t.destinationLocation].recovery+=t.recoveryAmount||0;

    if(!totalsByCurrency[t.currency]) totalsByCurrency[t.currency]={amount:0,fees:0,recovery:0};
    totalsByCurrency[t.currency].amount+=t.amount||0;
    totalsByCurrency[t.currency].fees+=t.fees||0;
    totalsByCurrency[t.currency].recovery+=t.recoveryAmount||0;
  });

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
    table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
    th{background:#ff8c42;color:white;}
    .retired{background:#fff3b0;}
    tfoot td{font-weight:bold;background:#e9ecef;}
    .totaux{background:#ffe4b0;font-weight:bold;}
    button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
    .modify{background:#28a745;}
    .delete{background:#dc3545;}
    .retirer{background:#ff9900;}
    .imprimer{background:#17a2b8;}
    input,select{padding:5px;margin-right:5px;font-size:14px;}
    .scrollable{overflow-x:auto;}
    @media(max-width:700px){table,thead,tbody,th,td,tr{display:block;} th{text-align:left;} td{border:none;position:relative;padding-left:50%;} td::before{position:absolute;left:10px;top:6px;white-space:nowrap;font-weight:bold;}}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <input type="text" id="search" placeholder="Recherche..." value="${search}">
  <select id="status">
    <option value="all" ${status==='all'?'selected':''}>Tous</option>
    <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
    <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
  </select>
  ${req.session.user.permissions.ecriture?'<a href="/transferts/form">➕ Nouveau</a>':''}
  <a href="/logout">🚪 Déconnexion</a>
  <div class="scrollable">
  <table>
    <thead><tr>
      <th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th>
      <th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Mode retrait</th><th>Status</th><th>Actions</th>
    </tr></thead>
    <tbody>
      <tr class="totaux"><td colspan="6">Totaux généraux</td><td>${totalAmount}</td><td>${totalFees}</td><td>${totalRecovery}</td><td colspan="4"></td></tr>
      ${Object.entries(totalsByDest).map(([dest,d])=>`<tr class="totaux"><td colspan="5">Totaux pour ${dest}</td><td></td><td>${d.amount}</td><td>${d.fees}</td><td>${d.recovery}</td><td colspan="4"></td></tr>`).join('')}
      ${Object.entries(totalsByCurrency).map(([cur,c])=>`<tr class="totaux"><td colspan="5">Totaux pour ${cur}</td><td></td><td>${c.amount}</td><td>${c.fees}</td><td>${c.recovery}</td><td colspan="4"></td></tr>`).join('')}
`;

transferts.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td><td>${t.userType}</td>
      <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
      <td>${t.originLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td>
      <td>${t.currency}</td><td>${t.recoveryMode||''}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        ${req.session.user.permissions.modification?`<button class="modify">✏️</button>`:''}
        ${req.session.user.permissions.suppression?`<button class="delete">❌</button>`:''}
        ${req.session.user.permissions.retrait && !t.retired?`<button class="retirer">💰 Retirer</button>`:''}
        ${req.session.user.permissions.imprimer?`<button class="imprimer">🖨</button>`:''}
      </td>
    </tr>`;
});

html+=`</tbody></table></div>
<script>
    document.getElementById('search').oninput=()=>{window.location='/transferts/list?search='+encodeURIComponent(document.getElementById('search').value)+'&status='+document.getElementById('status').value;};
    document.getElementById('status').onchange=()=>{window.location='/transferts/list?search='+encodeURIComponent(document.getElementById('search').value)+'&status='+document.getElementById('status').value;};
    document.querySelectorAll('.modify').forEach(btn=>{btn.onclick=()=>{const tr=btn.closest('tr');window.location='/transferts/form?code='+tr.children[0].innerText;}});
    document.querySelectorAll('.delete').forEach(btn=>{btn.onclick=async()=>{if(confirm('❌ Confirmer suppression?')){const tr=btn.closest('tr');await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tr.dataset.id})});tr.remove();}}});
    document.querySelectorAll('.retirer').forEach(btn=>{btn.onclick=async()=>{const tr=btn.closest('tr');await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tr.dataset.id})});tr.children[11].innerText='Retiré';btn.remove();}});
    document.querySelectorAll('.imprimer').forEach(btn=>{btn.onclick=()=>{const tr=btn.closest('tr');window.open('/transferts/pdf/'+tr.dataset.id,'_blank');}});
</script></body></html>`;
res.send(html);
});

// ---------- AJAX ----------
app.post('/transferts/delete', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.send({ok:true}); });
app.post('/transferts/retirer', requireLogin, async(req,res)=>{ await Transfert.findByIdAndUpdate(req.body.id,{retired:true}); res.send({ok:true}); });

// ---------- EXPORT PDF ----------
app.get('/transferts/pdf/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  const doc = new PDFDocument();
  res.setHeader('Content-Disposition','inline; filename="transfert.pdf"');
  res.setHeader('Content-Type','application/pdf');
  doc.text(`Transfert Code: ${t.code}\nExpéditeur: ${t.senderFirstName} ${t.senderLastName}\nDestinataire: ${t.receiverFirstName} ${t.receiverLastName}\nMontant: ${t.amount} ${t.currency}\nFrais: ${t.fees}\nÀ recevoir: ${t.recoveryAmount}\nStatus: ${t.retired?'Retiré':'Non retiré'}`,{lineGap:6});
  doc.pipe(res); doc.end();
});

// ---------- EXPORT EXCEL ----------
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code',key:'code',width:15},{header:'Type',key:'userType',width:15},{header:'Expéditeur',key:'sender',width:30},
    {header:'Origine',key:'origin',width:15},{header:'Destinataire',key:'receiver',width:30},{header:'Destination',key:'destination',width:15},
    {header:'Montant',key:'amount',width:15},{header:'Frais',key:'fees',width:15},{header:'À recevoir',key:'recovery',width:15},
    {header:'Devise',key:'currency',width:10},{header:'Mode retrait',key:'mode',width:15},{header:'Status',key:'status',width:15},{header:'Date',key:'date',width:20}
  ];
  transferts.forEach(t=>sheet.addRow({
    code:t.code,userType:t.userType,
    sender:t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')',
    origin:t.originLocation,
    receiver:t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')',
    destination:t.destinationLocation,
    amount:t.amount,fees:t.fees,recovery:t.recoveryAmount,
    currency:t.currency,mode:t.recoveryMode||'',status:t.retired?'Retiré':'Non retiré',date:t.createdAt
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res); res.end();
});

// ---------- SERVEUR ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`Server running on http://0.0.0.0:${PORT}`));
