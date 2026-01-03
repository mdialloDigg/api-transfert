/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION FINALE
 ******************************************************************/

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: process.env.SESSION_SECRET || 'transfert-secret-final', resave: false, saveUninitialized: true }));

// ================= DATABASE =================
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

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

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: { type: String, default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code: String,
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: String,
  date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

function setPermissions(username){
  if(username==='a') return { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true };
  if(username==='admin2') return { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true };
  return { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true };
}

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
  </div></body></html>`);
});

app.post('/login', async(req,res)=>{
  try{
    const {username,password} = req.body;
    let user = await Auth.findOne({username});
    if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user={ username:user.username, role:user.role, permissions:setPermissions(username) };
    res.redirect('/dashboard');
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur lors de la connexion');
  }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  try{
    const { search='', status='all' } = req.query;
    const transfertsRaw = await Transfert.find().sort({createdAt:-1});
    const stockHistory = await StockHistory.find().sort({date:-1});

    const s = search.toLowerCase();
    let transferts = transfertsRaw.filter(t=>{
      return t.code.toLowerCase().includes(s)
        || t.senderFirstName.toLowerCase().includes(s)
        || t.senderLastName.toLowerCase().includes(s)
        || (t.senderPhone||'').toLowerCase().includes(s)
        || t.receiverFirstName.toLowerCase().includes(s)
        || t.receiverLastName.toLowerCase().includes(s)
        || (t.receiverPhone||'').toLowerCase().includes(s);
    });
    if(status==='retire') transferts=transferts.filter(t=>t.retired);
    else if(status==='non') transferts=transferts.filter(t=>!t.retired);

    const totalsByDestination={};
    transferts.forEach(t=>{
      if(!totalsByDestination[t.destinationLocation]) totalsByDestination[t.destinationLocation]=0;
      totalsByDestination[t.destinationLocation] += t.amount;
    });

    let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top;}
    th{background:#ff8c42;color:white;}
    </style></head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>

    <h3>Transferts</h3>
    <table>
      <tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th><th>Montant destination</th></tr>`;

    transferts.forEach(t=>{
      html+=`<tr>
        <td>${t.code}</td>
        <td>${t.senderFirstName} ${t.senderLastName}<br>📞 ${t.senderPhone||'-'}</td>
        <td>${t.receiverFirstName} ${t.receiverLastName}<br>📞 ${t.receiverPhone||'-'}</td>
        <td>${t.amount}</td>
        <td>${t.currency}</td>
        <td>${t.retired?'Retiré':'Non retiré'}</td>
        <td>${totalsByDestination[t.destinationLocation]}</td>
      </tr>`;
    });

    html+=`</table>
    <h3>Historique Stocks</h3>
    <table>
      <tr><th>Date</th><th>Code</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;

    stockHistory.forEach(h=>{
      html+=`<tr>
        <td>${h.date.toLocaleString()}</td>
        <td>${h.code}</td>
        <td>${h.action}</td>
        <td>${h.sender}<br>📞 ${h.senderPhone||'-'}</td>
        <td>${h.destination}<br>📞 ${h.destinationPhone||'-'}</td>
        <td>${h.amount}</td>
      </tr>`;
    });

    html+='</table></body></html>';
    res.send(html);

  } catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur lors du chargement du dashboard');
  }
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(data._id) await Transfert.findByIdAndUpdate(data._id,{...data});
    else{
      const code = data.code || await generateUniqueCode();
      await new Transfert({...data,code,retraitHistory:[]}).save();
    }
    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur lors de l\'enregistrement du transfert'});
  }
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndDelete(req.body.id);
    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur lors de la suppression du transfert'});
  }
});

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id,mode} = req.body;
    await Transfert.findByIdAndUpdate(id,{retired:true,$push:{retraitHistory:{date:new Date(),mode}}});
    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur lors du retrait'});
  }
});

app.get('/transferts/get/:id', requireLogin, async(req,res)=>{
  try{
    const t = await Transfert.findById(req.params.id);
    res.json(t);
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Transfert introuvable'});
  }
});

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(data._id) await StockHistory.findByIdAndUpdate(data._id,{...data});
    else{
      const code = data.code || await generateUniqueCode();
      await new StockHistory({...data,code}).save();
    }
    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur lors de l\'enregistrement du stock'});
  }
});

app.post('/stocks/delete', requireLogin, async(req,res)=>{
  try{
    await StockHistory.findByIdAndDelete(req.body.id);
    res.json({ok:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Erreur lors de la suppression du stocks'});
  }
});

app.get('/stocks/get/:id', requireLogin, async(req,res)=>{
  try{
    const s = await StockHistory.findById(req.params.id);
    res.json(s);
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Stock introuvable'});
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
