/******************************************************************
 * APP TRANSFERT + MINI-ADMIN UTILISATEURS – VERSION ULTIME TOUT-EN-UN
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

// ================= DATABASE TRANSFERT =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB transferts connecté'))
  .catch(console.error);

// ================= SCHEMA TRANSFERT =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

// ================= SCHEMA AUTH =================
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

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){ return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true }; }

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
  .login-container button:hover{background:#e67300;}
  </style></head><body>
  <div class="login-container">
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Se connecter</button>
  </form>
  </div></body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SEED TRANSFERTS =================
async function seedTransferts(){
  const count = await Transfert.countDocuments();
  if(count>0) return;
  for(let i=1;i<=10;i++){
    const amount = 100*i;
    const fees = 10*i;
    const recovery = amount - fees;
    const code = await generateUniqueCode();
    await new Transfert({
      userType: 'Client',
      senderFirstName:'Exp'+i, senderLastName:'Test'+i, senderPhone:'2210000'+i, originLocation:'Conakry',
      receiverFirstName:'Dest'+i, receiverLastName:'Test'+i, receiverPhone:'2211000'+i, destinationLocation:'France',
      amount, fees, recoveryAmount:recovery, currency:'USD', recoveryMode:'Espèces', code
    }).save();
  }
}
seedTransferts();

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
  .container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
  form{display:grid;gap:15px;}
  label{font-weight:bold;margin-bottom:5px;display:block;}
  input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
  input[readonly]{background:#e9ecef;}
  button{padding:15px;background:#ff8c42;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;}
  </style></head><body><div class="container">
  <h2>${t?'Modifier':'Nouveau'} Transfert</h2>
  <form method="post">
    <label>Code</label><input name="code" value="${code}" readonly>
    <label>Expéditeur Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required>
    <label>Expéditeur Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required>
    <label>Expéditeur Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required>
    <label>Destinataire Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required>
    <label>Destinataire Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required>
    <label>Destinataire Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required>
    <label>Montant</label><input type="number" id="amount" name="amount" value="${t?t.amount:''}" required>
    <label>Frais</label><input type="number" id="fees" name="fees" value="${t?t.fees:''}" required>
    <label>Montant à recevoir</label><input type="text" id="recoveryAmount" name="recoveryAmount" readonly value="${t?t.recoveryAmount:''}">
    <label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
    <label>Mode de retrait</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
    <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
  </form>
  <a href="/transferts/list">⬅ Retour liste</a>
  <script>
    const amountField=document.getElementById('amount');
    const feesField=document.getElementById('fees');
    const recoveryField=document.getElementById('recoveryAmount');
    function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
    amountField.addEventListener('input',updateRecovery);
    feesField.addEventListener('input',updateRecovery);
    updateRecovery();
  </script>
  </div></body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ================= LISTE TRANSFERTS =================
app.get(['/transferts','/transferts/list'], requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>t.code.toLowerCase().includes(s) || t.senderFirstName.toLowerCase().includes(s) || t.receiverFirstName.toLowerCase().includes(s));
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  const limit = 20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <a href="/transferts/form">➕ Nouveau</a>
  <table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Status</th><th>Actions</th></tr></thead><tbody>`;
  paginated.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
    <td>${t.code}</td>
    <td>${t.senderFirstName} ${t.senderLastName}</td>
    <td>${t.receiverFirstName} ${t.receiverLastName}</td>
    <td>${t.amount}</td>
    <td>${t.fees}</td>
    <td>${t.recoveryAmount}</td>
    <td>${t.retired?'Retiré':'Non retiré'}</td>
    <td>
      <a href="/transferts/form?code=${t.code}"><button class="modify">✏️ Modifier</button></a>
      ${!t.retired?`<button class="retirer">💰 Retirer</button>`:''}
      <button class="delete">❌ Supprimer</button>
    </td>
    </tr>`;
  });
  html+='</tbody></table>';
  html+='<a href="/logout">🚪 Déconnexion</a>';
  html+=`<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{if(confirm('Confirmer suppression?')){const tr=btn.closest('tr');await postData('/transferts/delete',{id:tr.dataset.id});tr.remove();}});
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{const tr=btn.closest('tr');await postData('/transferts/retirer',{id:tr.dataset.id,mode:"Espèces"});tr.querySelector('td:nth-child(7)').innerText="Retiré";btn.remove();});
  </script>`;
  html+='</body></html>';
  res.send(html);
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.send({ok:true});
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= EXPORT PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const doc = new PDFDocument({ margin:30, size:'A4' });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts', {align:'center'}).moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code:${t.code} | Exp:${t.senderFirstName} ${t.senderLastName} | Dest:${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}`);
    doc.moveDown(0.3);
  });
  doc.end();
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns=[
    {header:'Code',key:'code',width:15},{header:'Type',key:'userType',width:20},
    {header:'Expéditeur',key:'sender',width:30},{header:'Origine',key:'originLocation',width:15},
    {header:'Destinataire',key:'receiver',width:30},{header:'Destination',key:'destinationLocation',width:15},
    {header:'Montant',key:'amount',width:12},{header:'Frais',key:'fees',width:12},{header:'Reçu',key:'recoveryAmount',width:12},
    {header:'Devise',key:'currency',width:10},{header:'Statut',key:'status',width:12},{header:'Date',key:'createdAt',width:20}
  ];
  transferts.forEach(t=>{
    sheet.addRow({code:t.code,userType:t.userType,sender:`${t.senderFirstName} ${t.senderLastName}`,originLocation:t.originLocation,receiver:`${t.receiverFirstName} ${t.receiverLastName}`,destinationLocation:t.destinationLocation,amount:t.amount,fees:t.fees,recoveryAmount:t.recoveryAmount,currency:t.currency,status:t.retired?'Retiré':'Non retiré',createdAt:t.createdAt.toLocaleString()});
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res); res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html='<html><head><meta charset="UTF-8"></head><body><h2>Liste des transferts</h2><table border="1" cellpadding="5" cellspacing="0"><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Statut</th></tr>';
  transferts.forEach(t=>{html+=`<tr><td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.retired?'Retiré':'Non retiré'}</td></tr>`;});
  html+='</table></body></html>';
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename=transferts.doc');
  res.send(html);
});

// ================= DATABASE USERS =================
const mongoose2 = require('mongoose');
mongoose2.connect(process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/test')
  .then(()=>console.log('✅ MongoDB utilisateurs connecté'))
  .catch(console.error);
const userSchema = new mongoose2.Schema({}, { strict:false });
const User = mongoose2.model('User', userSchema, 'users');

// ================= SEED USERS =================
async function seedUsers(){
  const count = await User.countDocuments();
  if(count>0) return;
  for(let i=1;i<=10;i++) await new User({ username:'user'+i,email:'user'+i+'@test.com',role:'agent',password:'pass'+i });
}
seedUsers();

// ================= MINI-ADMIN USERS =================
app.get('/users/list', requireLogin, async(req,res)=>{
  const users = await User.find().limit(20);
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  </style></head><body><h2>📋 Liste des utilisateurs</h2>
  <table><thead><tr>`;
  if(users.length>0) Object.keys(users[0].toObject()).forEach(k=>html+=`<th>${k}</th>`); html+='<th>Actions</th></tr></thead><tbody>';
  users.forEach(u=>{
    const obj = u.toObject();
    html+='<tr data-id="'+u._id+'">';
    Object.keys(obj).forEach(k=>html+=`<td>${obj[k]}</td>`);
    html+='</tr>';
  });
  html+='</tbody></table><a href="/logout">🚪 Déconnexion</a></body></html>';
  res.send(html);
});

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
