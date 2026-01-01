/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN AVEC FALLBACK MÉMOIRE
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
let dbConnected = false;
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>{ console.log('✅ MongoDB connecté'); dbConnected = true; })
  .catch(err=>{ console.log('⚠ MongoDB indisponible, fallback mémoire activé'); dbConnected = false; });

// ================= MEMORY FALLBACK =================
const memory = { transferts: [], auth: [] };

// ================= SCHEMAS =================
let Transfert, Auth;
if(dbConnected){
  const transfertSchema = new mongoose.Schema({
    userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
    senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
    receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
    amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
    recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
    code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
  });
  Transfert = mongoose.model('Transfert', transfertSchema);

  const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
  Auth = mongoose.model('Auth', authSchema);
}

// ================= UTIL =================
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    if(dbConnected) exists = await Transfert.findOne({ code }).exec();
    else exists = memory.transferts.find(t=>t.code===code);
  }
  return code;
}

// ================= FALLBACK HELPERS =================
async function findTransferts(){ return dbConnected ? await Transfert.find().exec() : memory.transferts; }
async function findTransfertByCode(code){ return dbConnected ? await Transfert.findOne({code}).exec() : memory.transferts.find(t=>t.code===code); }
async function saveTransfert(obj){ if(dbConnected){ await new Transfert(obj).save(); } else { obj._id = String(Date.now()) ; memory.transferts.push(obj); } }
async function updateTransfert(id,obj){ 
  if(dbConnected){ await Transfert.findByIdAndUpdate(id,obj); } 
  else { const idx = memory.transferts.findIndex(t=>t._id==id); if(idx!==-1) memory.transferts[idx]={...memory.transferts[idx], ...obj}; }
}
async function deleteTransfert(id){ 
  if(dbConnected){ await Transfert.findByIdAndDelete(id); } 
  else { memory.transferts = memory.transferts.filter(t=>t._id!=id); }
}

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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
    </div>
  </body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user;
  if(dbConnected) user = await Auth.findOne({ username }).exec();
  else user = memory.auth.find(u=>u.username===username);

  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = { username, password:hashed, role:'agent', _id:String(Date.now()) };
    if(dbConnected) await new Auth(user).save();
    else memory.auth.push(user);
  }

  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t = req.query.code ? await findTransfertByCode(req.query.code) : null;
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||''; const status = req.query.status||'all';

  // Formulaire HTML simplifié pour exemple (tu peux réutiliser ton HTML complet)
  res.send(`<html><body>
    <h2>${t?'Modifier':'Nouveau'} Transfert</h2>
    <form method="post">
      <input name="userType" value="${t?t.userType:'Client'}">
      <input name="senderFirstName" value="${t?t.senderFirstName:''}">
      <input name="senderLastName" value="${t?t.senderLastName:''}">
      <input name="senderPhone" value="${t?t.senderPhone:''}">
      <input name="originLocation" value="${t?t.originLocation:''}">
      <input name="receiverFirstName" value="${t?t.receiverFirstName:''}">
      <input name="receiverLastName" value="${t?t.receiverLastName:''}">
      <input name="receiverPhone" value="${t?t.receiverPhone:''}">
      <input name="destinationLocation" value="${t?t.destinationLocation:''}">
      <input name="amount" value="${t?t.amount:0}">
      <input name="fees" value="${t?t.fees:0}">
      <input name="currency" value="${t?t.currency:'GNF'}">
      <input name="code" value="${code}">
      <button>Enregistrer</button>
    </form>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await findTransfertByCode(code);

  const transfertObj = {...req.body, amount, fees, recoveryAmount, retraitHistory:[], retired:false, code, createdAt: new Date()};
  if(existing) await updateTransfert(existing._id, transfertObj);
  else await saveTransfert(transfertObj);

  res.redirect(`/transferts/list`);
});

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const search = (req.query.search||'').toLowerCase();
  const status = req.query.status||'all';
  let transferts = await findTransferts();

  transferts = transferts.filter(t=>{
    const match = [t.code,t.senderFirstName,t.senderLastName,t.senderPhone,t.receiverFirstName,t.receiverLastName,t.receiverPhone]
      .some(f => f && f.toLowerCase().includes(search));
    if(!match) return false;
    if(status==='retire') return t.retired;
    if(status==='non') return !t.retired;
    return true;
  });

  // Liste HTML simplifiée
  res.send(`<html><body>
    <h2>Liste des transferts</h2>
    <a href="/transferts/form">Nouveau</a>
    <table border="1"><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Statut</th></tr>
      ${transferts.map(t=>`<tr>
        <td>${t.code}</td>
        <td>${t.senderFirstName} ${t.senderLastName}</td>
        <td>${t.receiverFirstName} ${t.receiverLastName}</td>
        <td>${t.amount}</td>
        <td>${t.fees}</td>
        <td>${t.recoveryAmount}</td>
        <td>${t.retired?'Retiré':'Non retiré'}</td>
      </tr>`).join('')}
    </table>
  </body></html>`);
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await updateTransfert(req.body.id,{retired:true, recoveryMode:req.body.mode, retraitHistory:[{date:new Date(), mode:req.body.mode}]});
  res.send({ok:true});
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await deleteTransfert(req.body.id);
  res.send({ok:true});
});

// ================= EXPORT PDF / EXCEL / WORD =================
// Tu peux réutiliser le code complet des exports que je t’ai fourni dans le message précédent

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
