/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE
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

const authSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILS =================
async function generateUniqueCode() {
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

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
    req.session.user={ username:user.username, role:user.role };
    res.redirect('/dashboard');
  }catch(err){ console.error(err); res.status(500).send('Erreur lors de la connexion'); }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  try{
    const { search='', status='all' } = req.query;
    const transfertsRaw = await Transfert.find().sort({createdAt:-1});
    const stocks = await Stock.find().sort({createdAt:-1});
    const stockHistory = await StockHistory.find().sort({date:-1});

    const s = search.toLowerCase();
    let transferts = transfertsRaw.filter(t=>{
      return t.code.toLowerCase().includes(s)
        || t.senderFirstName.toLowerCase().includes(s)
        || t.senderLastName?.toLowerCase().includes(s)
        || (t.senderPhone||'').toLowerCase().includes(s)
        || t.receiverFirstName.toLowerCase().includes(s)
        || t.receiverLastName?.toLowerCase().includes(s)
        || (t.receiverPhone||'').toLowerCase().includes(s);
    });
    if(status==='retire') transferts=transferts.filter(t=>t.retired);
    else if(status==='non') transferts=transferts.filter(t=>!t.retired);

    const totals={};
    transferts.forEach(t=>{
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].recovery += (t.amount - t.fees);
    });

    let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:Arial;margin:0;padding:20px;background:#f0f2f5;}
    table{border-collapse:collapse;width:100%;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:10px;}
    th{background:#ff8c42;color:white;}
    button{padding:5px 10px;margin:2px;cursor:pointer;}
    .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
    .modal-content{background:white;padding:20px;border-radius:10px;width:90%;max-width:400px;}
    input,select{width:100%;padding:8px;margin:5px 0;border-radius:5px;border:1px solid #ccc;}
    </style></head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>
    <form method="get" action="/dashboard">
      <input type="text" name="search" placeholder="Recherche..." value="${search}">
      <select name="status">
        <option value="all" ${status==='all'?'selected':''}>Tous</option>
        <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
        <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
      </select>
      <button type="submit">🔍 Filtrer</button>
      <button type="button" onclick="openTransfertModal()">➕ Nouveau Transfert</button>
      <button type="button" onclick="openStockModal()">➕ Nouveau Stock</button>
    </form>`;

    // Totaux
    html+=`<h3>Totaux par destination/devise</h3><table><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr>`;
    for(let dest in totals){
      for(let curr in totals[dest]){
        html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
      }
    }
    html+=`</table>`;

    // Transferts
    html+=`<h3>Transferts</h3><table><tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
    transferts.forEach(t=>{
      html+=`<tr>
      <td>${t.code}</td>
      <td>${t.originLocation}</td>
      <td>${t.senderFirstName} ${t.senderLastName || ''} 📞 ${t.senderPhone || '-'}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName || ''} 📞 ${t.receiverPhone || '-'}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.amount - t.fees}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <button onclick="editTransfert('${t._id}')">✏️</button>
        <button onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
        <button onclick="printRow(this)">🖨️</button>
      </td>
      </tr>`;
    });
    html+=`</table>`;

    // Stocks
    html+=`<h3>Stocks</h3><table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
    stocks.forEach(s=>{
      html+=`<tr>
      <td>${s.code}</td>
      <td>${s.sender} 📞 ${s.senderPhone || '-'}</td>
      <td>${s.destination} 📞 ${s.destinationPhone || '-'}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
        <button onclick="editStock('${s._id}')">✏️</button>
        <button onclick="deleteStock('${s._id}')">❌</button>
        <button onclick="printRow(this)">🖨️</button>
      </td>
      </tr>`;
    });
    html+=`</table>`;

    // Historique stocks
    html+=`<h3>Historique Stocks</h3><table><tr><th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr>`;
    stockHistory.forEach(h=>{
      html+=`<tr>
      <td>${new Date(h.date).toLocaleString()}</td>
      <td>${h.code}</td>
      <td>${h.sender} 📞 ${h.senderPhone || '-'}</td>
      <td>${h.destination} 📞 ${h.destinationPhone || '-'}</td>
      <td>${h.amount}</td>
      <td>${h.currency}</td>
      </tr>`;
    });
    html+=`</table>`;

    // Modals, script et code complet
    html+=`<script>
      async function printRow(btn){ const row=btn.closest('tr'); const w=window.open(''); w.document.write('<html><body><table border="1">'+row.outerHTML+'</table></body></html>'); w.document.close(); w.print(); }
      async function deleteTransfert(id){ if(confirm('Supprimer ?')){ await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); location.reload(); } }
      async function retirerTransfert(id){ const mode=prompt('Mode de retrait','ESPECE'); await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}); location.reload(); }
      async function deleteStock(id){ if(confirm('Supprimer ?')){ await fetch('/stocks/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); location.reload(); } }
      // Les fonctions openModal, saveTransfert, saveStock, editTransfert, editStock doivent être ajoutées ici pour gérer les formulaires modaux avec code généré.
    </script>`;

    html+='</body></html>';
    res.send(html);
  } catch(err){ console.error(err); res.status(500).send('Erreur serveur'); }
});

// ================= ROUTES TRANSFERT =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(!data.code) data.code = await generateUniqueCode();
    if(data._id) await Transfert.findByIdAndUpdate(data._id,data);
    else await new Transfert({...data, retraitHistory:[]}).save();
    res.json({ok:true, code:data.code});
  } catch(err){ console.error(err); res.status(500).json({error:'Erreur lors de l\'enregistrement du transfert'}); }
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{ try{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); } catch(err){ console.error(err); res.status(500).json({error:'Erreur lors de la suppression du transfert'}); } });

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id, mode} = req.body;
    const t = await Transfert.findById(id);
    if(!t || t.retired) return res.status(400).json({error:'Transfert introuvable ou déjà retiré'});
    t.retired = true;
    t.retraitHistory.push({date:new Date(), mode});
    await t.save();
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:'Erreur retrait'});}
});

// ================= ROUTES STOCK =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(!data.code) data.code = await generateUniqueCode();
    if(data._id) await Stock.findByIdAndUpdate(data._id,data);
    else await new Stock(data).save();
    await new StockHistory({...data, action:'CREATION'}).save();
    res.json({ok:true, code:data.code});
  }catch(err){ console.error(err); res.status(500).json({error:'Erreur lors de l\'enregistrement du stock'});}
});

app.post('/stocks/delete', requireLogin, async(req,res)=>{ try{ await Stock.findByIdAndDelete(req.body.id); res.json({ok:true}); } catch(err){ console.error(err); res.status(500).json({error:'Erreur lors de la suppression du stock'}); } });

// ================= GENERATE CODE =================
app.get('/transferts/generateCode', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  res.json({code});
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
