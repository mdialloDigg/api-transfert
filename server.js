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
  currency: { type: String, enum:['GNF','EUR','USD'], default:'GNF' },
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

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){ return { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true }; }

const destinations = ['France','Guinée'];
const currencies = ['EUR','USD','GNF'];

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
    const transferts = await Transfert.find().sort({createdAt:-1});
    const stocks = await Stock.find().sort({createdAt:-1});
    const stockHistory = await StockHistory.find().sort({date:-1});

    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
      table{border-collapse:collapse;width:100%;margin-bottom:20px;}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;}
      th{background:#ff8c42;color:white;}
      button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;margin-right:3px;font-size:12px;}
      .modify{background:#28a745;} .delete{background:#dc3545;} .retirer{background:#ff9900;} .print{background:#007bff;}
      .table-container{overflow-x:auto;}
      @media(max-width:768px){table,thead,tbody,tr,th,td{display:block;}thead tr{display:none;}tr{margin-bottom:15px;}td{border:none;position:relative;padding-left:50%;}td::before{content:attr(data-label);position:absolute;left:10px;font-weight:bold;}}
    </style></head><body>
    <h2>Dashboard</h2>
    <a href="/logout">Déconnexion</a>
    <h3>Transferts</h3>
    <div class="table-container"><table>
      <tr>
        <th>Code</th><th>UserType</th><th>Expéditeur</th><th>Destinataire</th>
        <th>Origine</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th>
        <th>Devise</th><th>Mode retrait</th><th>Status</th><th>Actions</th>
      </tr>`;

    transferts.forEach(t=>{
      html+=`<tr>
      <td data-label="Code">${t.code}</td>
      <td data-label="UserType">${t.userType}</td>
      <td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName}<br>${t.senderPhone||'-'}</td>
      <td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName}<br>${t.receiverPhone||'-'}</td>
      <td data-label="Origine">${t.originLocation||'-'}</td>
      <td data-label="Destination">${t.destinationLocation||'-'}</td>
      <td data-label="Montant">${t.amount}</td>
      <td data-label="Frais">${t.fees}</td>
      <td data-label="Reçu">${t.recoveryAmount}</td>
      <td data-label="Devise">${t.currency}</td>
      <td data-label="Mode retrait">${t.recoveryMode||'-'}</td>
      <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
      <td data-label="Actions">
        <button class="print" onclick="printRow(this)">🖨️</button>
        <button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
        <button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
      </td></tr>`;
    });

    html+=`</table></div>`;

    // ==================== Stocks ====================
    html+=`<h3>Stocks</h3><div class="table-container"><table>
      <tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Date</th><th>Actions</th></tr>`;
    stocks.forEach(s=>{
      html+=`<tr>
      <td data-label="Code">${s.code}</td>
      <td data-label="Expéditeur">${s.sender}<br>${s.senderPhone||'-'}</td>
      <td data-label="Destination">${s.destination}<br>${s.destinationPhone||'-'}</td>
      <td data-label="Montant">${s.amount}</td>
      <td data-label="Devise">${s.currency}</td>
      <td data-label="Date">${s.createdAt.toLocaleString()}</td>
      <td data-label="Actions">
        <button class="print" onclick="printRow(this)">🖨️</button>
        <button class="modify" onclick="editStock('${s._id}')">✏️</button>
        <button class="delete" onclick="deleteStock('${s._id}')">❌</button>
      </td></tr>`;
    });
    html+=`</table></div>`;

    // ==================== Historique Stocks ====================
    html+=`<h3>Historique Stocks</h3><div class="table-container"><table>
      <tr><th>Date</th><th>Code</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th></tr>`;
    stockHistory.forEach(h=>{
      html+=`<tr>
      <td data-label="Date">${h.date.toLocaleString()}</td>
      <td data-label="Code">${h.code}</td>
      <td data-label="Action">${h.action}</td>
      <td data-label="Expéditeur">${h.sender}<br>${h.senderPhone||'-'}</td>
      <td data-label="Destination">${h.destination}<br>${h.destinationPhone||'-'}</td>
      <td data-label="Montant">${h.amount}</td>
      <td data-label="Devise">${h.currency}</td>
      </tr>`;
    });
    html+=`</table></div>`;

    // ==================== Scripts ====================
    html+=`<script>
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
    function printRow(btn){const row=btn.closest('tr');const nw=window.open('','PRINT','height=600,width=800');nw.document.write('<html><head><title>Imprimer</title></head><body>');nw.document.write('<table border="1">'+row.outerHTML+'</table></body></html>');nw.document.close();nw.print();nw.close();}
    async function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){await postData('/transferts/delete',{id});location.reload();}}
    async function retirerTransfert(id){const mode=prompt('Mode de retrait','Espèces');if(mode){await postData('/transferts/retirer',{id,mode});location.reload();}}
    async function editTransfert(id){const t=await(await fetch('/transferts/get/'+id)).json(); const data={...t}; const fields=['senderFirstName','senderLastName','senderPhone','receiverFirstName','receiverLastName','receiverPhone','originLocation','destinationLocation','amount','fees','recoveryAmount','currency','userType','recoveryMode']; for(let f of fields){const val=prompt(f,data[f]); if(val!==null)data[f]=val;} await postData('/transferts/form',data);location.reload();}
    async function deleteStock(id){if(confirm('Supprimer ce stock ?')){await postData('/stocks/delete',{id});location.reload();}}
    async function editStock(id){const s=await(await fetch('/stocks/get/'+id)).json(); const fields=['sender','senderPhone','destination','destinationPhone','amount','currency']; for(let f of fields){const val=prompt(f,s[f]); if(val!==null)s[f]=val;} await postData('/stocks/new',s);location.reload();}
    </script>`;

    html+='</body></html>';
    res.send(html);

  } catch(err){console.error(err);res.status(500).send('Erreur serveur');}
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{ const data=req.body; if(data._id) await Transfert.findByIdAndUpdate(data._id,data); else{const code = await generateUniqueCode(); await new Transfert({...data,code,retraitHistory:[]}).save();} res.json({ok:true}); }
  catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{try{await Transfert.findByIdAndDelete(req.body.id);res.json({ok:true});}catch(err){console.error(err);res.status(500).json({error:'Erreur'});}});
app.post('/transferts/retirer', requireLogin, async(req,res)=>{try{const {id,mode}=req.body;await Transfert.findByIdAndUpdate(id,{retired:true,$push:{retraitHistory:{date:new Date(),mode}}});res.json({ok:true});}catch(err){console.error(err);res.status(500).json({error:'Erreur'});}});
app.get('/transferts/get/:id', requireLogin, async(req,res)=>{try{const t=await Transfert.findById(req.params.id);res.json(t);}catch(err){console.error(err);res.status(500).json({error:'Introuvable'});}});

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{ const data=req.body; if(data._id) await Stock.findByIdAndUpdate(data._id,data); else{const code=await generateUniqueCode(); await new Stock({...data,code}).save();} res.json({ok:true}); }
  catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});
app.post('/stocks/delete', requireLogin, async(req,res)=>{try{await Stock.findByIdAndDelete(req.body.id);res.json({ok:true});}catch(err){console.error(err);res.status(500).json({error:'Erreur'});}});
app.get('/stocks/get/:id', requireLogin, async(req,res)=>{try{const s=await Stock.findById(req.params.id);res.json(s);}catch(err){console.error(err);res.status(500).json({error:'Introuvable'});}});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
