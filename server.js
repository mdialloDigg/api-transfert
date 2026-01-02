/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION FULL INTERFACE + RENDER READY
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
.catch(err=>console.error('❌ MongoDB non connecté:', err.message));

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType:{ type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
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
  sender:String, destination:String, amount:Number, currency:{ type:String, default:'GNF' }, createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  action:String, stockId:mongoose.Schema.Types.ObjectId, sender:String, destination:String, amount:Number, currency:String, date:{ type:Date, default:Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

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
  res.send(`<html><body>
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required>
      <input type="password" name="password" placeholder="Mot de passe" required>
      <button>Connexion</button>
    </form>
  </body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= TRANSFERT FORM =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();

  // Form HTML simplifié pour exemple
  res.send(`<html><body>
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
    Expéditeur Prénom <input name="senderFirstName" value="${t?t.senderFirstName:''}"><br>
    Expéditeur Nom <input name="senderLastName" value="${t?t.senderLastName:''}"><br>
    Expéditeur Téléphone <input name="senderPhone" value="${t?t.senderPhone:''}"><br>
    Destination <input name="destinationLocation" value="${t?t.destinationLocation:''}"><br>
    Montant <input type="number" id="amount" name="amount" value="${t?t.amount:''}"><br>
    Frais <input type="number" id="fees" name="fees" value="${t?t.fees:''}"><br>
    Montant à recevoir <input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"><br>
    Devise <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select><br>
    Code <input name="code" value="${code}" readonly><br>
    <button>Enregistrer</button>
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
  </body></html>`);
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
  res.redirect(`/transferts/list`);
});

// ================= TRANSFERT LIST + STOCKS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html = `<h2>📋 Liste des transferts</h2>
  <a href="/transferts/form">➕ Nouveau transfert</a> | <a href="/stocks">📦 Stocks</a> | <a href="/logout">🚪 Déconnexion</a>
  <table border="1" cellpadding="5">
  <tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;
  transferts.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.amount} ${t.currency}</td>
    </tr>`;
  });
  html+='</table>';
  res.send(html);
});

// ================= STOCKS =================
app.get('/stocks', requireLogin, async(req,res)=>{
  const stocks = await Stock.find().sort({createdAt:-1});
  const history = await StockHistory.find().sort({date:-1});
  let html = `<h2>📦 Gestion des stocks</h2>
  <a href="/stocks/new">➕ Nouveau stock</a> | <a href="/transferts/list">⬅ Retour</a>
  <h3>Stocks</h3>
  <table border="1" cellpadding="5">
  <tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{
    html+=`<tr>
      <td>${s.sender}</td>
      <td>${s.destination}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
        <a href="/stocks/edit/${s._id}">✏️</a>
        <a href="/stocks/delete/${s._id}" onclick="return confirm('Supprimer ?')">❌</a>
      </td>
    </tr>`;
  });
  html+=`</table>
  <h3>📜 Historique des stocks</h3>
  <table border="1" cellpadding="5">
  <tr><th>Date</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;
  history.forEach(h=>{
    html+=`<tr>
      <td>${h.date.toLocaleString()}</td>
      <td>${h.action}</td>
      <td>${h.sender}</td>
      <td>${h.destination}</td>
      <td>${h.amount} ${h.currency}</td>
    </tr>`;
  });
  html+=`</table>`;
  res.send(html);
});

// CRUD Stocks simplified for brevity
app.get('/stocks/new', requireLogin,(req,res)=>res.send(`
<h2>➕ Nouveau stock</h2>
<form method="post">
Expéditeur <input name="sender" required><br>
Destination <input name="destination" required><br>
Montant <input type="number" name="amount" required><br>
Devise <input name="currency" value="GNF"><br>
<button>Enregistrer</button>
</form>
`));
app.post('/stocks/new', requireLogin, async(req,res)=>{ const stock=await new Stock(req.body).save(); await new StockHistory({action:'AJOUT', stockId:stock._id,...req.body}).save(); res.redirect('/stocks'); });
app.get('/stocks/edit/:id', requireLogin, async(req,res)=>{ const s=await Stock.findById(req.params.id); res.send(`<h2>✏️ Modifier stock</h2><form method="post">Expéditeur<input name="sender" value="${s.sender}"><br>Destination<input name="destination" value="${s.destination}"><br>Montant<input type="number" name="amount" value="${s.amount}"><br>Devise<input name="currency" value="${s.currency}"><br><button>Modifier</button></form>`); });
app.post('/stocks/edit/:id', requireLogin, async(req,res)=>{ await Stock.findByIdAndUpdate(req.params.id,req.body); await new StockHistory({action:'MODIFICATION',stockId:req.params.id,...req.body}).save(); res.redirect('/stocks'); });
app.get('/stocks/delete/:id', requireLogin, async(req,res)=>{ const s=await Stock.findById(req.params.id); await Stock.findByIdAndDelete(req.params.id); await new StockHistory({action:'SUPPRESSION',stockId:s._id,sender:s.sender,destination:s.destination,amount:s.amount,currency:s.currency}).save(); res.redirect('/stocks'); });

// ================= SERVER =================
app.listen(process.env.PORT || 3000, ()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
