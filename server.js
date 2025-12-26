/******************************************************************
 * APP TRANSFERT – TOUT-EN-UN AVEC AJAX ET EXPORT
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:false,retrait:false,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:80px;">
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
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||''; const status = req.query.status||'all';
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
  <div style="max-width:800px;margin:40px auto;background:#fff;padding:20px;border-radius:12px;">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
    <input type="hidden" name="_search" value="${search}">
    <input type="hidden" name="_status" value="${status}">
    Type: <select name="userType">
      <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
      <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
      <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
      <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
    </select><br>
    Expéditeur: <input name="senderFirstName" value="${t?t.senderFirstName:''}" placeholder="Prénom"> 
    <input name="senderLastName" value="${t?t.senderLastName:''}" placeholder="Nom">
    <input name="senderPhone" value="${t?t.senderPhone:''}" placeholder="Téléphone"><br>
    Origine: <select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`)}</select><br>
    Destinataire: <input name="receiverFirstName" value="${t?t.receiverFirstName:''}" placeholder="Prénom">
    <input name="receiverLastName" value="${t?t.receiverLastName:''}" placeholder="Nom">
    <input name="receiverPhone" value="${t?t.receiverPhone:''}" placeholder="Téléphone"><br>
    Destination: <select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`)}</select><br>
    Montant: <input type="number" name="amount" id="amount" value="${t?t.amount:''}">
    Frais: <input type="number" name="fees" id="fees" value="${t?t.fees:''}">
    Reçu: <input type="text" name="recoveryAmount" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"><br>
    Devise: <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`)}</select><br>
    Code: <input type="text" name="code" readonly value="${code}"><br>
    <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
  </form>
  <a href="/transferts/list?search=${encodeURIComponent(search)}&status=${status}">⬅ Retour liste</a>
  <script>
    const a=document.getElementById('amount'),f=document.getElementById('fees'),r=document.getElementById('recoveryAmount');
    function update(){r.value=(parseFloat(a.value)||0)-(parseFloat(f.value)||0);}
    a.addEventListener('input',update);f.addEventListener('input',update);update();
  </script>
  </div></body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount = Number(req.body.amount||0), fees = Number(req.body.fees||0), recoveryAmount = amount-fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  const search = req.body._search||'', status = req.body._status||'all';
  res.redirect(`/transferts/list?search=${encodeURIComponent(search)}&status=${status}`);
});

// ================= LISTE AJAX =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  const limit=20;
  let transferts = await Transfert.find().sort({createdAt:-1});
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts=transferts.filter(t=>t.retired);
  else if(status==='non') transferts=transferts.filter(t=>!t.retired);
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);

  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;} table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:6px;} .retired{background:#fff3b0;} button{cursor:pointer;} </style></head><body>`;
  html+=`<h2>📋 Liste des transferts</h2>
  <form id="filterForm">
    <input name="search" placeholder="Recherche..." value="${search}">
    <select name="status">
      <option value="all" ${status==='all'?'selected':''}>Tous</option>
      <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
      <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
    </select>
    <button type="submit">Filtrer</button>
  </form>
  ${req.session.user.permissions.ecriture?`<a href="/transferts/form">➕ Nouveau</a>`:''}
  <table><thead><tr>
    <th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>`;
  paginated.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}">
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
      ${req.session.user.permissions.modification?`<a href="/transferts/form?code=${t.code}&search=${search}&status=${status}">✏️</a>`:''}
      ${req.session.user.permissions.suppression?`<button class="delete" data-id="${t._id}">❌</button>`:''}
      ${req.session.user.permissions.retrait && !t.retired?`<select class="mode" data-id="${t._id}">${retraitModes.map(m=>`<option>${m}</option>`)}</select><button class="retirer" data-id="${t._id}">💰</button>`:''}
      ${req.session.user.permissions.imprimer?`<a href="/transferts/print/${t._id}" target="_blank">🖨</a>`:''}
      </td>
    </tr>`;
  });
  html+='</tbody></table>';
  html+=`<div>Pages: `;
  for(let i=1;i<=totalPages;i++){ html+=`<a href="?page=${i}&search=${search}&status=${status}">${i}</a> `; }
  html+='</div>';
  html+=`<script>
    document.querySelectorAll(".delete").forEach(b=>{b.onclick=async()=>{if(confirm("Confirmer?")){let id=b.dataset.id; await fetch("/transferts/delete/"+id); location.reload();}}});
    document.querySelectorAll(".retirer").forEach(b=>{b.onclick=async()=>{let id=b.dataset.id; let mode=document.querySelector(".mode[data-id='"+id+"']").value; await fetch("/transferts/retirer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,mode})}); location.reload();}});
    document.getElementById("filterForm").onsubmit=async e=>{e.preventDefault(); const f=e.target; location.href="?search="+f.search.value+"&status="+f.status.value;}
  </script>`;
  html+='</body></html>';
  res.send(html);
});

// ================= POST RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const { id, mode } = req.body;
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(id,{retired:true,recoveryMode:mode,$push:{retraitHistory:{date:new Date(),mode}}});
  res.sendStatus(200);
});

// ================= POST DELETE =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.params.id);
  res.sendStatus(200);
});

// ================= PRINT TICKET =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body style="text-align:center;font-family:Arial;padding:10px;">
    <div style="border:1px dashed #333;padding:10px;width:280px;margin:auto;">
    <h3>💰 Transfert</h3>
    <p>Code: ${t.code}</p>
    <p>Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
    <p>Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
    <p>Montant: ${t.amount} ${t.currency}</p>
    <p>Frais: ${t.fees}</p>
    <p>Reçu: ${t.recoveryAmount}</p>
    <p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
    </div>
    <button onclick="window.print()">🖨 Imprimer</button>
  </body></html>`);
});

// ================= EXPORT PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const doc = new PDFDocument({ margin:30, size:'A4' });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts',{align:'center'}).moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code: ${t.code} | Exp: ${t.senderFirstName} ${t.senderLastName} | Dest: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Statut: ${t.retired?'Retiré':'Non retiré'}`);
    doc.moveDown(0.3);
  });
  doc.end();
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    { header:'Code', key:'code', width:15 },
    { header:'Type', key:'userType', width:20 },
    { header:'Expéditeur', key:'sender', width:30 },
    { header:'Origine', key:'originLocation', width:15 },
    { header:'Destinataire', key:'receiver', width:30 },
    { header:'Destination', key:'destinationLocation', width:15 },
    { header:'Montant', key:'amount', width:12 },
    { header:'Frais', key:'fees', width:12 },
    { header:'Reçu', key:'recoveryAmount', width:12 },
    { header:'Devise', key:'currency', width:10 },
    { header:'Statut', key:'status', width:12 },
    { header:'Date', key:'createdAt', width:20 },
  ];
  transferts.forEach(t=>{
    sheet.addRow({
      code:t.code, userType:t.userType,
      sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
      originLocation:t.originLocation,
      receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
      destinationLocation:t.destinationLocation,
      amount:t.amount, fees:t.fees, recoveryAmount:t.recoveryAmount,
      currency:t.currency,
      status:t.retired?'Retiré':'Non retiré',
      createdAt:t.createdAt.toLocaleString()
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html = `<html><body><h2>Liste des transferts</h2><table border="1" cellpadding="4">
    <tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Statut</th></tr>`;
  transferts.forEach(t=>{
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
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename="transferts.doc"');
  res.send(html);
});

// ================= START SERVER =================
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
