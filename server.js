/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE
 * DASHBOARD + CRUD + VALIDATIONS STRICTES + CLIENT JS
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

// ================= CONSTANTES =================
const ALLOWED_CURRENCIES = ['GNF','XOF','EUR','USD'];
const ALLOWED_LOCATIONS = ['FRANCE','LABE','CONAKRY','SUISSE','BELGIQUE','ALLEMAGNE','USA'];
const ALLOWED_RETRAIT_MODES = ['ESPECE','TRANSFERT','VIREMENT','AUTRE'];

function normalizeUpper(v){ return (v||'').toString().trim().toUpperCase(); }
function isValidPhone(phone){ return /^00224\d{9}$/.test(phone) || /^0033\d{9}$/.test(phone); }

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
  currency: { type: String, enum: ALLOWED_CURRENCIES, default:'GNF' },
  recoveryMode: { type: String, enum: ALLOWED_RETRAIT_MODES, default:'ESPECE' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  destinationFirstName: String,
  destinationLastName: String,
  destinationPhone: String,
  amount: Number,
  currency: { type: String, enum: ALLOWED_CURRENCIES, default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code: String,
  action: String,
  stockId: mongoose.Schema.Types.ObjectId,
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  destinationFirstName: String,
  destinationLastName: String,
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
    const transferts = await Transfert.find().sort({createdAt:-1});
    const stocks = await Stock.find().sort({createdAt:-1});
    const stockHistory = await StockHistory.find().sort({date:-1});

    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard</title>
    <style>
    body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
    h2,h3,h4{margin-top:20px;color:#333;}
    a{color:#007bff;text-decoration:none;margin-right:10px;}
    a:hover{text-decoration:underline;}
    input,select,button{padding:8px;margin:5px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;}
    button{cursor:pointer;transition:0.3s;}
    button.modify{background:#28a745;color:white;}
    button.delete{background:#dc3545;color:white;}
    button.retirer{background:#ff9900;color:white;}
    button.print{background:#007bff;color:white;}
    .table-container{width:100%;overflow-x:auto;margin-bottom:20px;}
    table{border-collapse:collapse;width:100%;min-width:600px;}
    th,td{border:1px solid #ccc;padding:10px;text-align:left;vertical-align:top;}
    th{background:#ff8c42;color:white;}
    @media(max-width:768px){
      table,thead,tbody,th,td,tr{display:block;}
      thead tr{display:none;}
      tr{margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px;}
      td{border:none;position:relative;padding-left:50%;text-align:left;}
      td::before{content: attr(data-label);position:absolute;left:10px;top:10px;font-weight:bold;white-space:nowrap;}
    }
    </style></head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>
    <h3>Transferts</h3>
    <button onclick="newTransfert()">➕ Nouveau Transfert</button>
    <div class="table-container"><table id="transfertTable"><thead><tr>
    <th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th>
    <th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>`;

    transferts.forEach(t=>{
      html+=`<tr data-id="${t._id}">
      <td>${t.code}</td>
      <td>${t.originLocation}</td>
      <td>${t.senderFirstName} ${t.senderLastName}<br>📞 ${t.senderPhone}</td>
      <td>${t.destinationLocation}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}<br>📞 ${t.receiverPhone}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.amount - t.fees}</td>
      <td>${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
      <button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
      <button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
      ${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}
      <button class="print" onclick="printRow(this)">🖨️</button>
      </td></tr>`;
    });

    html+=`</tbody></table></div>`;

    // ===== STOCKS =====
    html+=`<h3>Stocks</h3><button onclick="newStock()">➕ Nouveau Stock</button>
    <div class="table-container"><table id="stockTable"><thead><tr>
    <th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th>
    </tr></thead><tbody>`;

    stocks.forEach(s=>{
      html+=`<tr data-id="${s._id}">
      <td>${s.code}</td>
      <td>${s.senderFirstName} ${s.senderLastName}<br>📞 ${s.senderPhone}</td>
      <td>${s.destinationFirstName} ${s.destinationLastName}<br>📞 ${s.destinationPhone}</td>
      <td>${s.amount}</td>
      <td>${s.currency}</td>
      <td>
      <button class="modify" onclick="editStock('${s._id}')">✏️</button>
      <button class="delete" onclick="deleteStock('${s._id}')">❌</button>
      <button class="print" onclick="printRow(this)">🖨️</button>
      </td></tr>`;
    });

    html+=`</tbody></table></div>`;

    // ===== HISTORIQUE =====
    html+=`<h3>Historique Stocks</h3>
    <div class="table-container"><table id="historyTable"><thead><tr>
    <th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th>
    </tr></thead><tbody>`;

    stockHistory.forEach(h=>{
      html+=`<tr>
      <td>${h.date.toLocaleString()}</td>
      <td>${h.code}</td>
      <td>${h.senderFirstName} ${h.senderLastName}<br>📞 ${h.senderPhone}</td>
      <td>${h.destinationFirstName} ${h.destinationLastName}<br>📞 ${h.destinationPhone}</td>
      <td>${h.amount}</td>
      <td><button class="print" onclick="printRow(this)">🖨️</button></td>
      </tr>`;
    });

    html+=`</tbody></table></div>`;

    // ================= SCRIPT =================
    html+=`<script>
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

    function normalizeUpper(v){ return (v||'').toString().trim().toUpperCase(); }
    function isValidPhone(phone){ return /^00224\\d{9}$/.test(phone) || /^0033\\d{9}$/.test(phone); }

    async function newTransfert(){
      const origin=normalizeUpper(prompt('Origine (FRANCE, LABE, CONAKRY, SUISSE, BELGIQUE, ALLEMAGNE, USA)'));
      if(!${JSON.stringify(ALLOWED_LOCATIONS)}.includes(origin)){alert('Origine invalide');return;}
      const senderFirstName=prompt('Prénom expéditeur'); if(!senderFirstName){alert('Prénom obligatoire');return;}
      const senderLastName=prompt('Nom expéditeur'); if(!senderLastName){alert('Nom obligatoire');return;}
      const senderPhone=prompt('Téléphone expéditeur (00224XXXXXXXXX ou 0033XXXXXXXXX)'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      const destination=normalizeUpper(prompt('Destination')); if(!${JSON.stringify(ALLOWED_LOCATIONS)}.includes(destination)){alert('Destination invalide');return;}
      const receiverFirstName=prompt('Prénom destinataire'); if(!receiverFirstName){alert('Prénom obligatoire');return;}
      const receiverLastName=prompt('Nom destinataire'); if(!receiverLastName){alert('Nom obligatoire');return;}
      const receiverPhone=prompt('Téléphone destinataire (00224XXXXXXXXX ou 0033XXXXXXXXX)'); if(!isValidPhone(receiverPhone)){alert('Téléphone invalide');return;}
      const amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      const fees=parseFloat(prompt('Frais')); if(isNaN(fees)||fees<0){alert('Frais invalide');return;}
      const currency=normalizeUpper(prompt('Devise (GNF,XOF,EUR,USD)','GNF')); if(!${JSON.stringify(ALLOWED_CURRENCIES)}.includes(currency)){alert('Devise invalide');return;}
      const recoveryMode=normalizeUpper(prompt('Mode de retrait (ESPECE, TRANSFERT, VIREMENT, AUTRE)','ESPECE')); if(!${JSON.stringify(ALLOWED_RETRAIT_MODES)}.includes(recoveryMode)){alert('Mode invalide');return;}
      await postData('/transferts/form',{userType:'Client',originLocation:origin,senderFirstName,senderLastName,senderPhone,destinationLocation:destination,receiverFirstName,receiverLastName,receiverPhone,amount,fees,recoveryAmount:amount-fees,currency,recoveryMode});
      location.reload();
    }

    async function deleteTransfert(id){ if(confirm('Supprimer ce transfert ?')){ await postData('/transferts/delete',{id}); location.reload(); } }
    async function retirerTransfert(id){ const mode=normalizeUpper(prompt('Mode de retrait')); if(!${JSON.stringify(ALLOWED_RETRAIT_MODES)}.includes(mode)){alert('Mode invalide'); return;} await postData('/transferts/retirer',{id,mode}); location.reload(); }

    async function newStock(){
      const senderFirstName=prompt('Prénom expéditeur'); if(!senderFirstName){alert('Prénom obligatoire');return;}
      const senderLastName=prompt('Nom expéditeur'); if(!senderLastName){alert('Nom obligatoire');return;}
      const senderPhone=prompt('Téléphone expéditeur'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      const destinationFirstName=prompt('Prénom destinataire'); if(!destinationFirstName){alert('Prénom obligatoire');return;}
      const destinationLastName=prompt('Nom destinataire'); if(!destinationLastName){alert('Nom obligatoire');return;}
      const destinationPhone=prompt('Téléphone destinataire'); if(!isValidPhone(destinationPhone)){alert('Téléphone invalide');return;}
      const amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      const currency=normalizeUpper(prompt('Devise (GNF,XOF,EUR,USD)','GNF')); if(!${JSON.stringify(ALLOWED_CURRENCIES)}.includes(currency)){alert('Devise invalide');return;}
      await postData('/stocks/new',{senderFirstName,senderLastName,senderPhone,destinationFirstName,destinationLastName,destinationPhone,amount,currency});
      location.reload();
    }

    async function deleteStock(id){ if(confirm('Supprimer ce stock ?')){ await postData('/stocks/delete',{id}); location.reload(); } }
    function printRow(btn){ const row=btn.closest('tr'); const newWin=window.open(''); newWin.document.write('<html><head><title>Impression</title></head><body>'); newWin.document.write('<table border="1" style="border-collapse:collapse; font-family:Arial; padding:10px;">'); newWin.document.write(row.outerHTML); newWin.document.write('</table></body></html>'); newWin.print(); }

    function editTransfert(id){ alert('Edition non implémentée dans cette démo'); }
    function editStock(id){ alert('Edition non implémentée dans cette démo'); }
    </script>`;

    html+='</body></html>';
    res.send(html);

  } catch(err){ console.error(err); res.status(500).send('Erreur serveur'); }
});

// ================= ROUTES TRANSFERT =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(data._id) await Transfert.findByIdAndUpdate(data._id,{...data});
    else{
      const code = data.code || await generateUniqueCode();
      await new Transfert({...data,code,retraitHistory:[]}).save();
    }
    res.json({ok:true});
  }catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  try{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); } 
  catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id,mode} = req.body;
    const transfert = await Transfert.findById(id);
    if(!transfert) return res.status(404).json({error:'Transfert introuvable'});
    if(transfert.retired) return res.status(400).json({error:'Déjà retiré'});
    if(!ALLOWED_RETRAIT_MODES.includes(normalizeUpper(mode))) return res.status(400).json({error:'Mode invalide'});
    transfert.retired=true;
    transfert.retraitHistory.push({date:new Date(),mode:normalizeUpper(mode)});
    await transfert.save();
    res.json({ok:true});
  }catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});

// ================= ROUTES STOCK =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(data._id) await Stock.findByIdAndUpdate(data._id,{...data});
    else{
      const code = data.code || await generateUniqueCode();
      await new Stock({...data,code}).save();
    }
    res.json({ok:true});
  }catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});

app.post('/stocks/delete', requireLogin, async(req,res)=>{
  try{ await Stock.findByIdAndDelete(req.body.id); res.json({ok:true}); } 
  catch(err){console.error(err);res.status(500).json({error:'Erreur'});}
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(\`🚀 Serveur lancé sur http://localhost:\${PORT}\`));
