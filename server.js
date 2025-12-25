/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET MODERNE
 ******************************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();
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

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
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

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= REDIRECTION ROOT =================
app.get('/', (req,res)=> res.redirect('/menu'));

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;background:#fff3e0;padding:30px;text-align:center;}
    input,select,button{padding:10px;margin:5px;width:90%;}
    button{background:#ff9800;color:#fff;border:none;border-radius:6px;cursor:pointer;}
  </style></head>
  <body>
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required><br>
      <input type="password" name="password" placeholder="Mot de passe" required><br>
      <button>Connexion</button>
    </form>
  </body></html>`);
});

app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    await new Auth({ username, password: hashed }).save();
    req.session.user = username;
    return res.redirect('/menu');
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = username;
  res.redirect('/menu');
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;background:#fff3e0;text-align:center;padding:30px;}
    button{padding:10px;margin:5px;width:200px;border:none;border-radius:6px;color:white;cursor:pointer;}
    .orange{background:#ff9800;}
    .green{background:#4caf50;}
    .red{background:#f44336;}
  </style></head>
  <body>
    <h2>📲 Gestion des transferts</h2>
    <a href="/transferts/form"><button class="orange">➕ Envoyer de l'argent</button></a><br>
    <a href="/transferts/list"><button class="green">📋 Liste / Historique</button></a><br>
    <a href="/logout"><button class="red">🚪 Déconnexion</button></a>
  </body></html>`);
});

// ================= FORMULAIRE =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const userTypes = ['Client','Distributeur','Administrateur','Agence de transfert'];

app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;background:#fff3e0;padding:20px;}
    input,select,button{padding:10px;margin:5px;width:95%;}
    button{background:#ff9800;color:#fff;border:none;border-radius:6px;}
  </style></head>
  <body>
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <label>Type de personne</label>
      <select name="userType" required>${userTypes.map(u=>`<option ${t&&t.userType===u?'selected':''}>${u}</option>`).join('')}</select><br>
      <h3>Expéditeur</h3>
      <input name="senderFirstName" placeholder="Prénom" value="${t?t.senderFirstName:''}" required>
      <input name="senderLastName" placeholder="Nom" value="${t?t.senderLastName:''}" required>
      <input name="senderPhone" placeholder="Téléphone" value="${t?t.senderPhone:''}" required>
      <select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select><br>
      <h3>Destinataire</h3>
      <input name="receiverFirstName" placeholder="Prénom" value="${t?t.receiverFirstName:''}" required>
      <input name="receiverLastName" placeholder="Nom" value="${t?t.receiverLastName:''}" required>
      <input name="receiverPhone" placeholder="Téléphone" value="${t?t.receiverPhone:''}" required>
      <select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select><br>
      <h3>Montants & Devise</h3>
      <input type="number" id="amount" name="amount" placeholder="Montant" value="${t?t.amount:''}" required>
      <input type="number" id="fees" name="fees" placeholder="Frais" value="${t?t.fees:''}" required>
      <input type="text" id="recoveryAmount" readonly placeholder="Montant à recevoir" value="${t?t.recoveryAmount:''}">
      <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select><br>
      <label>Code transfert</label>
      <input name="code" readonly value="${code}"><br>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/menu">⬅ Retour menu</a>
    <script>
      const amountField=document.getElementById('amount');
      const feesField=document.getElementById('fees');
      const recoveryField=document.getElementById('recoveryAmount');
      function updateRecovery(){recoveryField.value=(parseFloat(amountField.value||0)-parseFloat(feesField.value||0)).toFixed(2);}
      amountField.addEventListener('input',updateRecovery);
      feesField.addEventListener('input',updateRecovery);
      updateRecovery();
    </script>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const data = req.body;
  data.amount = Number(data.amount||0);
  data.fees = Number(data.fees||0);
  data.recoveryAmount = data.amount - data.fees;
  let existing = await Transfert.findOne({ code:data.code });
  if(existing){
    await Transfert.findByIdAndUpdate(existing._id,data);
  }else{
    data.retraitHistory=[];
    await new Transfert(data).save();
  }
  res.redirect('/transferts/list');
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,
    recoveryMode:req.body.mode,
    $push:{ retraitHistory:{ date:new Date(), mode:req.body.mode } }
  });
  res.redirect('/transferts/list');
});

// ================= IMPRIMER =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;text-align:center;padding:20px;}
    .ticket{border:1px dashed #333;padding:15px;width:300px;margin:auto;}
    button{margin-top:10px;padding:8px 15px;}
  </style></head><body>
    <div class="ticket">
      <h3>💰 Transfert</h3>
      <p>Code: ${t.code}</p>
      <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
      <p>Origine: ${t.originLocation}</p>
      <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
      <p>Destination: ${t.destinationLocation}</p>
      <p>Montant: ${t.amount} ${t.currency}</p>
      <p>Frais: ${t.fees} ${t.currency}</p>
      <p>À recevoir: ${t.recoveryAmount} ${t.currency}</p>
      <p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
      <button onclick="window.print()">🖨️ Imprimer</button>
    </div>
  </body></html>`);
});

// ================= PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const list = await Transfert.find().sort({destinationLocation:1, retired:1});
  const doc = new PDFDocument({margin:30, size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
  doc.pipe(res);
  doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'}).moveDown();
  list.forEach(t=>{
    doc.fontSize(12).text(`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Montant: ${t.amount} ${t.currency} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Statut: ${t.retired?'Retiré':'Non retiré'}`);
  });
  doc.end();
});

// ================= LISTE AJAX + ANIMATIONS + GRAPH =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  res.sendFile(__dirname+'/list.html'); // on suppose que tu mets le HTML AJAX/Chart.js dans list.html
});

app.get('/transferts/ajax', requireLogin, async(req,res)=>{
  let list = await Transfert.find().sort({destinationLocation:1, retired:1, createdAt:-1});
  const { phone, code, name, country, currency } = req.query;
  if(phone) list = list.filter(t=>t.senderPhone.includes(phone) || t.receiverPhone.includes(phone));
  if(code) list = list.filter(t=>t.code.includes(code));
  if(name) list = list.filter(t=>t.senderFirstName.includes(name)||t.senderLastName.includes(name)||t.receiverFirstName.includes(name)||t.receiverLastName.includes(name));
  if(country) list = list.filter(t=>t.originLocation.includes(country)||t.destinationLocation.includes(country));
  if(currency) list = list.filter(t=>t.currency===currency);
  res.json(list);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
