/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE AVEC MOBILE ET HISTORIQUE
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
  }catch(err){ console.error(err); res.status(500).send('Erreur lors de la connexion'); }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  try{
    const { search='', status='all' } = req.query;
    const transfertsRaw = await Transfert.find().sort({createdAt:-1});
    const stocksRaw = await Stock.find().sort({createdAt:-1});
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

    const totals={};
    transferts.forEach(t=>{
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].recovery += (t.amount - t.fees);
    });

    // ================== HTML ==================
    let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body { font-family: Arial; background:#f0f2f5; margin:0; padding:20px; }
    h2,h3,h4 { margin-top:20px; color:#333; }
    a { color:#007bff; text-decoration:none; margin-right:10px; }
    a:hover { text-decoration:underline; }
    input, select, button { padding:8px; margin:5px 0; border-radius:6px; border:1px solid #ccc; font-size:14px; }
    button { cursor:pointer; transition:0.3s; }
    button:hover { opacity:0.8; }
    button.modify { background: #28a745; color:white; }
    button.delete { background: #dc3545; color:white; }
    button.retirer { background: #ff9900; color:white; }
    button.print { background: #007bff; color:white; }

    .table-container { width:100%; overflow-x:auto; margin-bottom:20px; }
    table { border-collapse: collapse; width:100%; min-width:600px; }
    th, td { border:1px solid #ccc; padding:10px; text-align:left; vertical-align:top; }
    th { background:#ff8c42; color:white; }

    @media(max-width:768px){
      table, thead, tbody, th, td, tr { display:block; }
      thead tr { display:none; }
      tr { margin-bottom:15px; border-bottom:2px solid #ddd; padding-bottom:10px; }
      td { border:none; position:relative; padding-left:50%; text-align:left; }
      td::before { content: attr(data-label); position:absolute; left:10px; top:10px; font-weight:bold; white-space:nowrap; }
    }
    </style>
    </head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>

    <h3>Transferts</h3>
    <button onclick="openTransfertModal()">➕ Nouveau Transfert</button>
    <div class="table-container"><table>
      <tr><th>Code</th><th>Origin</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;

    transferts.forEach(t=>{
      html+=`<tr data-id="${t._id}">
        <td data-label="Code">${t.code}</td>
        <td data-label="Origin">${t.originLocation}</td>
        <td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName}<br>📞 ${t.senderPhone || '-'}</td>
        <td data-label="Destination">${t.destinationLocation}</td>
        <td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName}<br>📞 ${t.receiverPhone || '-'}</td>
        <td data-label="Montant">${t.amount}</td>
        <td data-label="Frais">${t.fees}</td>
        <td data-label="Reçu">${t.amount-t.fees}</td>
        <td data-label="Devise">${t.currency}</td>
        <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
        <td data-label="Actions">
          <button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
          <button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
          ${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
          <button class="print" onclick="printRow(this)">🖨️</button>
        </td>
      </tr>`;
    });
    html+=`</table></div>`;

    html+=`<h3>Stocks</h3><button onclick="openStockModal()">➕ Nouveau Stock</button>
    <div class="table-container"><table>
      <tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
    stocksRaw.forEach(s=>{
      html+=`<tr data-id="${s._id}">
        <td data-label="Code">${s.code}</td>
        <td data-label="Expéditeur">${s.sender}<br>📞 ${s.senderPhone||'-'}</td>
        <td data-label="Destination">${s.destination}<br>📞 ${s.destinationPhone||'-'}</td>
        <td data-label="Montant">${s.amount}</td>
        <td data-label="Devise">${s.currency}</td>
        <td data-label="Actions">
          <button class="modify" onclick="editStock('${s._id}')">✏️</button>
          <button class="delete" onclick="deleteStock('${s._id}')">❌</button>
          <button class="print" onclick="printRow(this)">🖨️</button>
        </td>
      </tr>`;
    });
    html+=`</table></div>`;

    html+=`<h3>Historique Stocks</h3>
    <div class="table-container"><table>
      <tr><th>Date</th><th>Code</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr>`;
    stockHistory.forEach(h=>{
      html+=`<tr>
        <td data-label="Date">${h.date.toLocaleString()}</td>
        <td data-label="Code">${h.code}</td>
        <td data-label="Action">${h.action}</td>
        <td data-label="Expéditeur">${h.sender}<br>📞 ${h.senderPhone||'-'}</td>
        <td data-label="Destination">${h.destination}<br>📞 ${h.destinationPhone||'-'}</td>
        <td data-label="Montant">${h.amount}</td>
        <td data-label="Devise">${h.currency}</td>
      </tr>`;
    });
    html+=`</table></div>`;

    html+=`<script>
    const ALLOWED_CURRENCIES=['GNF','XOF','EUR','USD'];
    const ALLOWED_LOCATIONS=['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'];
    const ALLOWED_RETRAIT_MODES=['ESPECE','TRANSFERT','VIREMENT','AUTRE'];
    function normalizeUpper(v){return (v||'').toString().trim().toUpperCase();}
    function isValidPhone(phone){return /^00224\\d{9}$/.test(phone) || /^0033\\d{9}$/.test(phone);}
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
    function printRow(btn){const row=btn.closest('tr');const w=window.open('');w.document.write('<html><body><table border=1>'+row.outerHTML+'</table></body></html>');w.document.close();w.print();}

    function openTransfertModal(){ /* Ici tu peux ajouter un modal HTML pour créer / modifier Transfert */ alert("Formulaire Transfert à implémenter"); }
    function openStockModal(){ alert("Formulaire Stock à implémenter"); }

    async function editTransfert(id){ const t=await (await fetch('/transferts/get/'+id)).json(); alert('Modifier Transfert '+t.code); }
    async function editStock(id){ const s=await (await fetch('/stocks/get/'+id)).json(); alert('Modifier Stock '+s.code); }

    async function deleteTransfert(id){ if(confirm("Supprimer ce transfert ?")){await postData("/transferts/delete",{id}); location.reload();} }
    async function deleteStock(id){ if(confirm("Supprimer ce stock ?")){await postData("/stocks/delete",{id}); location.reload();} }
    async function retirerTransfert(id){ const mode=prompt("Mode de retrait","ESPECE"); if(!ALLOWED_RETRAIT_MODES.includes(normalizeUpper(mode))){alert("Mode invalide");return;} await postData("/transferts/retirer",{id,mode:normalizeUpper(mode)}); location.reload(); }
    </script>`;

    html+='</body></html>';
    res.send(html);
  }catch(err){ console.error(err); res.status(500).send("Erreur serveur"); }
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{ const data=req.body;
    if(data._id) await Transfert.findByIdAndUpdate(data._id,{...data});
    else{ const code=await generateUniqueCode(); await new Transfert({...data,code,retraitHistory:[]}).save();}
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:"Erreur transfert"});}
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{ try{await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); }catch(err){console.error(err); res.status(500).json({error:"Erreur suppression"});} });
app.get('/transferts/get/:id', requireLogin, async(req,res)=>{ try{res.json(await Transfert.findById(req.params.id));}catch(err){console.error(err);res.status(500).json({error:"Introuvable"});} });
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id,mode} = req.body;
    const t = await Transfert.findById(id);
    if(!t) return res.status(404).json({error:"Introuvable"});
    if(t.retired) return res.status(400).json({error:"Déjà retiré"});
    t.retired=true;
    t.retraitHistory.push({date:new Date(),mode});
    await t.save();

    // Débiter stock correspondant
    const stock = await Stock.findOne({destination:t.destinationLocation,currency:t.currency});
    if(stock){ stock.amount -= (t.amount-t.fees); await stock.save(); await new StockHistory({code:t.code,action:"RETRAIT",stockId:stock._id,sender:t.senderFirstName,senderPhone:t.senderPhone,destination:t.destinationLocation,destinationPhone:t.receiverPhone,amount:-(t.amount-t.fees),currency:t.currency}).save(); }

    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:"Erreur retrait"});}
});

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{ const data=req.body;
    if(data._id){ await Stock.findByIdAndUpdate(data._id,{...data}); await new StockHistory({...data,action:"MODIFICATION"}).save();}
    else{ const code=await generateUniqueCode(); await new Stock({...data,code}).save(); await new StockHistory({...data,action:"CREATION",code}).save(); }
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:"Erreur stock"});}
});
app.post('/stocks/delete', requireLogin, async(req,res)=>{
  try{ const s=await Stock.findById(req.body.id); if(s){ await StockHistory.create({code:s.code,action:"SUPPRESSION",stockId:s._id,sender:s.sender,senderPhone:s.senderPhone,destination:s.destination,destinationPhone:s.destinationPhone,amount:s.amount,currency:s.currency}); await s.remove();} res.json({ok:true}); }
  catch(err){console.error(err);res.status(500).json({error:"Erreur suppression stock"});}
});
app.get('/stocks/get/:id', requireLogin, async(req,res)=>{ try{res.json(await Stock.findById(req.params.id)); }catch(err){console.error(err);res.status(500).json({error:"Introuvable"});} });

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
