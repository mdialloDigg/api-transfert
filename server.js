/******************************************************************
 * APP TRANSFERT + GESTION DE STOCKS – VERSION FINALE
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
app.use(session({
  secret:'transfert-secret-final',
  resave:false,
  saveUninitialized:true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================

// ----- TRANSFERT -----
const transfertSchema = new mongoose.Schema({
  userType:String,
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

// ----- AUTH -----
const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String, default:'agent'}
});
const Auth = mongoose.model('Auth', authSchema);

// ----- STOCK -----
const stockSchema = new mongoose.Schema({
  sender:String,
  destination:String,
  amount:Number,
  currency:{ type:String, default:'GNF' },
  createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

// ----- HISTORIQUE STOCK -----
const stockHistorySchema = new mongoose.Schema({
  action:String, // AJOUT | MODIFICATION | SUPPRESSION
  stockId:mongoose.Schema.Types.ObjectId,
  sender:String,
  destination:String,
  amount:Number,
  currency:String,
  date:{ type:Date, default:Date.now }
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

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required>
    <input type="password" name="password" placeholder="Mot de passe" required>
    <button>Connexion</button>
  </form>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){
    user = await new Auth({
      username,
      password:bcrypt.hashSync(password,10)
    }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = user;
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// ================= TRANSFERTS (LISTE MINIMALE) =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  let html = `<h2>📋 Transferts</h2>
  <a href="/stocks">📦 Stocks</a> | <a href="/logout">🚪 Déconnexion</a>
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

// ===================== STOCKS =====================

// ----- LISTE + HISTORIQUE -----
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

// ----- AJOUT -----
app.get('/stocks/new', requireLogin,(req,res)=>{
  res.send(`
  <h2>➕ Nouveau stock</h2>
  <form method="post">
    Expéditeur <input name="sender" required><br>
    Destination <input name="destination" required><br>
    Montant <input type="number" name="amount" required><br>
    Devise <input name="currency" value="GNF"><br>
    <button>Enregistrer</button>
  </form>`);
});

app.post('/stocks/new', requireLogin, async(req,res)=>{
  const stock = await new Stock(req.body).save();
  await new StockHistory({
    action:'AJOUT',
    stockId:stock._id,
    ...req.body
  }).save();
  res.redirect('/stocks');
});

// ----- MODIFICATION -----
app.get('/stocks/edit/:id', requireLogin, async(req,res)=>{
  const s = await Stock.findById(req.params.id);
  res.send(`
  <h2>✏️ Modifier stock</h2>
  <form method="post">
    Expéditeur <input name="sender" value="${s.sender}"><br>
    Destination <input name="destination" value="${s.destination}"><br>
    Montant <input type="number" name="amount" value="${s.amount}"><br>
    Devise <input name="currency" value="${s.currency}"><br>
    <button>Modifier</button>
  </form>`);
});

app.post('/stocks/edit/:id', requireLogin, async(req,res)=>{
  await Stock.findByIdAndUpdate(req.params.id, req.body);
  await new StockHistory({
    action:'MODIFICATION',
    stockId:req.params.id,
    ...req.body
  }).save();
  res.redirect('/stocks');
});

// ----- SUPPRESSION -----
app.get('/stocks/delete/:id', requireLogin, async(req,res)=>{
  const s = await Stock.findById(req.params.id);
  await Stock.findByIdAndDelete(req.params.id);
  await new StockHistory({
    action:'SUPPRESSION',
    stockId:s._id,
    sender:s.sender,
    destination:s.destination,
    amount:s.amount,
    currency:s.currency
  }).save();
  res.redirect('/stocks');
});

// ================= SERVER =================
app.listen(3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
