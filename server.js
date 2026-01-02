/******************************************************************
 * APP TRANSFERT – VERSION MOBILE-FRIENDLY TOUT-EN-UN
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= MONGODB =================
mongoose.connect('mongodb://127.0.0.1:27017/stockDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(()=>console.log('MongoDB connected')).catch(err=>console.error(err));

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

const stockSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  destination: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

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
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
      .login-container{background:white;padding:30px;border-radius:20px;box-shadow:0 8px 25px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
      .login-container h2{margin-bottom:25px;font-size:26px;color:#ff8c42;}
      .login-container input{width:100%;padding:12px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
      .login-container button{padding:12px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
      .login-container button:hover{background:#e67300;}
    </style>
  </head>
  <body>
    <div class="login-container">
      <h2>Connexion</h2>
      <form method="post">
        <input name="username" placeholder="Utilisateur" required>
        <input type="password" name="password" placeholder="Mot de passe" required>
        <button>Se connecter</button>
      </form>
    </div>
  </body>
  </html>`);
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

// ================= FORMULAIRE TRANSFERT MOBILE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();

  res.send(`<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
      .container{max-width:900px;margin:10px auto;padding:15px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
      h2{color:#ff8c42;text-align:center;margin-bottom:15px;}
      form{display:grid;gap:12px;}
      label{font-weight:bold;margin-bottom:5px;display:block;}
      input,select{padding:10px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:15px;}
      input[readonly]{background:#e9ecef;}
      button{padding:12px;background:#ff8c42;color:white;font-weight:bold;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
      button:hover{background:#e67300;}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}
      .section-title{margin-top:15px;font-size:16px;color:#ff8c42;font-weight:bold;border-bottom:2px solid #ff8c42;padding-bottom:5px;}
      a{display:inline-block;margin-top:10px;color:#ff8c42;text-decoration:none;font-weight:bold;}
      a:hover{text-decoration:underline;}
    </style>
  </head>
  <body>
    <div class="container">
      <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
      <form method="post">
        <div class="section-title">Type de personne</div>
        <select name="userType">
          <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
          <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
          <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
          <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
        </select>
        <div class="section-title">Expéditeur</div>
        <div class="grid">
          <div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
          <div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
          <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
          <div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="section-title">Destinataire</div>
        <div class="grid">
          <div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
          <div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
          <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
          <div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="section-title">Montants & Devise</div>
        <div class="grid">
          <div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
          <div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
          <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
          <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div><label>Code</label><input type="text" name="code" readonly value="${code}"></div>
        </div>
        <div class="section-title">Mode de retrait</div>
        <select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
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
    </div>
  </body>
  </html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ================= LANCEMENT SERVEUR =================
app.listen(PORT, ()=>console.log("Server ready on port " + PORT));
