/******************************************************************
 * APP COMPLETE TRANSFERT + STOCKS – READY TO DEPLOY
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

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
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
    .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
    .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
    .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
    .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
    .login-container button:hover{background:#e67300;}
  </style>
  </head><body>
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
  let user = await Auth.findOne({ username });
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= TRANSFERT LIST =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
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
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);

  const limit=20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);

  // Totaux par destination/devise
  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
    table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
    th{background:#ff8c42;color:white;}
    .retired{background:#fff3b0;}
    button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
    .modify{background:#28a745;}
    .delete{background:#dc3545;}
    .retirer{background:#ff9900;}
    a{margin-right:10px;text-decoration:none;color:#007bff;}
  </style>
  </head><body>
  <h2>📋 Liste des transferts</h2>
  <a href="/transferts/form">➕ Nouveau</a>
  <a href="/stocks">📦 Stocks</a>
  <a href="/logout">🚪 Déconnexion</a>
  <h3>Totaux par destination/devise</h3>
  <table><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr>`;
  for(let dest in totals){
    for(let curr in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html+='</table>';
  html+='<table><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th></tr>';
  paginated.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}" data-id="${t._id}">
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}</td>
      <td>${t.amount}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <a class="modify" href="/transferts/form?code=${t.code}">✏️</a>
        <button class="delete">❌</button>
        ${!t.retired?`<button class="retirer">💰 Retirer</button>`:''}
      </td>
    </tr>`;
  });
  html+='</table>';

  html+=`<script>
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{
    if(confirm('Supprimer ?')){
      const tr=btn.closest('tr'); const id=tr.dataset.id;
      await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      tr.remove();
    }
  });
  document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{
    const tr=btn.closest('tr'); const id=tr.dataset.id;
    await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:'Espèces'})});
    tr.querySelector('td:nth-child(6)').innerText='Retiré';
    btn.remove();
  });
  </script>`;

  res.send(html);
});

// ================= TRANSFERT CRUD =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.send({ok:true});
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= STOCKS =================
app.get('/stocks', requireLogin, async(req,res)=>{
  const stocks = await Stock.find().sort({createdAt:-1});
  const history = await StockHistory.find().sort({date:-1});
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
    table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
    th{background:#ff8c42;color:white;}
    button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
    .modify{background:#28a745;}
    .delete{background:#dc3545;}
    a{margin-right:10px;text-decoration:none;color:#007bff;}
  </style>
  </head><body>
  <h2>📦 Stocks</h2>
  <a href="/stocks/new">➕ Nouveau</a>
  <a href="/transferts/list">⬅ Transferts</a>
  <h3>Liste des stocks</h3>
  <table><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{ html+=`<tr data-id="${s._id}"><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td>
    <td><a class="modify" href="/stocks/edit/${s._id}">✏️</a> <button class="delete">❌</button></td></tr>`; });
  html+='</table>';

  html+='<h3>Historique</h3><table><tr><th>Date</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>';
  history.forEach(h=>{ html+=`<tr><td>${h.date.toLocaleString()}</td><td>${h.action}</td><td>${h.sender}</td><td>${h.destination}</td><td>${h.amount}</td></tr>`; });
  html+='</table>';

  html+=`<script>
    document.querySelectorAll('.delete').forEach(btn=>{
      btn.onclick=async()=>{
        if(confirm('Supprimer ?')){
          const tr=btn.closest('tr'); const id=tr.dataset.id;
          await fetch('/stocks/delete/'+id,{method:'GET'});
          tr.remove();
        }
      };
    });
  </script>`;

  res.send(html);
});

app.get('/stocks/new', requireLogin,(req,res)=>{
  res.send(`<form method="post" style="background:white;padding:20px;border-radius:10px;">
    Expéditeur: <input name="sender" required><br>
    Destination: <input name="destination" required><br>
    Montant: <input type="number" name="amount" required><br>
    <button>Ajouter</button>
    <a href="/stocks">⬅ Retour</a>
  </form>`);
});
app.post('/stocks/new', requireLogin, async(req,res)=>{
  const s = await new Stock(req.body).save();
  await new StockHistory({action:'AJOUT', stockId:s._id, ...req.body}).save();
  res.redirect('/stocks');
});
app.get('/stocks/edit/:id', requireLogin, async(req,res)=>{
  const s = await Stock.findById(req.params.id);
  res.send(`<form method="post" style="background:white;padding:20px;border-radius:10px;">
    Expéditeur: <input name="sender" value="${s.sender}" required><br>
    Destination: <input name="destination" value="${s.destination}" required><br>
    Montant: <input type="number" name="amount" value="${s.amount}" required><br>
    <button>Modifier</button>
    <a href="/stocks">⬅ Retour</a>
  </form>`);
});
app.post('/stocks/edit/:id', requireLogin, async(req,res)=>{
  await Stock.findByIdAndUpdate(req.params.id, req.body);
  await new StockHistory({action:'MODIFICATION', stockId:req.params.id, ...req.body}).save();
  res.redirect('/stocks');
});
app.get('/stocks/delete/:id', requireLogin, async(req,res)=>{
  const s = await Stock.findById(req.params.id);
  await Stock.findByIdAndDelete(req.params.id);
  await new StockHistory({action:'SUPPRESSION', stockId:s._id, ...s._doc}).save();
  res.redirect('/stocks');
});

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
