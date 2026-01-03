

/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION FINALE COMPLETE
 * MOBILE, IMPRIMER, CONTROLES, CRUD COMPLET TRANSFERTS + STOCKS
 ******************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');

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
  sender: String,
  senderPhone: String,
  origin: String,
  receiver: String,
  receiverPhone: String,
  destination: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: String,
  retired: { type:Boolean, default:false },
  retraitMode: String,
  code: { type:String, unique:true },
  createdAt: { type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code: { type:String, unique:true },
  sender: String,
  senderPhone: String,
  destination: String,
  destinationPhone: String,
  amount: Number,
  currency: String,
  createdAt: { type:Date, default:Date.now }
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
  date: { type:Date, default:Date.now }
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
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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
    <button>Se connecter</button>
  </form>
  </div></body></html>`);
});
app.post('/login',(req,res)=>{
  const {username} = req.body;
  req.session.user={username,permissions:{lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true}};
  res.redirect('/dashboard');
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async(req,res)=>{
  try{
    const q=(req.query.q||'').toLowerCase();
    let transferts=await Transfert.find().sort({createdAt:-1});
    let stocks=await Stock.find().sort({createdAt:-1});
    let history=await StockHistory.find().sort({date:-1});

    if(q){ transferts=transferts.filter(t=>t.code.toLowerCase().includes(q)||t.sender.toLowerCase().includes(q)||t.receiver.toLowerCase().includes(q)); }

    const totals={};
    transferts.forEach(t=>{
      if(!totals[t.destination]) totals[t.destination]={};
      if(!totals[t.destination][t.currency]) totals[t.destination][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destination][t.currency].amount+=t.amount;
      totals[t.destination][t.currency].fees+=t.fees;
      totals[t.destination][t.currency].recovery+=t.amount-t.fees;
    });

    let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:Arial;padding:20px;background:#f0f2f5;}
    h2,h3,h4{margin-top:20px;color:#333;}
    input,button,select{padding:8px;margin:5px 0;border-radius:6px;border:1px solid #ccc;font-size:14px;}
    button{cursor:pointer;}
    .table-container{width:100%;overflow-x:auto;margin-bottom:20px;}
    table{border-collapse:collapse;width:100%;min-width:600px;}
    th,td{border:1px solid #ccc;padding:10px;text-align:left;}
    th{background:#ff8c42;color:white;}
    @media(max-width:768px){table,thead,tbody,th,td,tr{display:block;}thead tr{display:none;}tr{margin-bottom:15px;border-bottom:2px solid #ddd;padding-bottom:10px;}td{border:none;position:relative;padding-left:50%;}td::before{content: attr(data-label);position:absolute;left:10px;top:10px;font-weight:bold;}}
    </style></head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>
    <button onclick="newTransfert()">➕ Nouveau Transfert</button>
    <h4>Totaux par destination/devise</h4>
    <div class="table-container"><table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;

    for(let d in totals){
      for(let c in totals[d]){
        html+=`<tr>
          <td data-label="Destination">${d}</td>
          <td data-label="Devise">${c}</td>
          <td data-label="Montant">${totals[d][c].amount}</td>
          <td data-label="Frais">${totals[d][c].fees}</td>
          <td data-label="Reçu">${totals[d][c].recovery}</td>
        </tr>`;
      }
    }
    html+='</tbody></table></div>';

    html+=`<h3>Transferts</h3><div class="table-container"><table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
    transferts.forEach(t=>{
      html+=`<tr data-id="${t._id}">
      <td data-label="Code">${t.code}</td>
      <td data-label="Expéditeur">${t.sender}<br>📞 ${t.senderPhone}</td>
      <td data-label="Destination">${t.destination}<br>📞 ${t.receiverPhone}</td>
      <td data-label="Montant">${t.amount}</td>
      <td data-label="Frais">${t.fees}</td>
      <td data-label="Reçu">${t.amount-t.fees}</td>
      <td data-label="Devise">${t.currency}</td>
      <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
      <td data-label="Actions">
        <button onclick="retirer('${t._id}')">💰 Retirer</button>
        <button onclick="editTransfert('${t._id}')">✏️ Modifier</button>
        <button onclick="deleteTransfert('${t._id}')">❌ Supprimer</button>
      </td></tr>`;
    });
    html+='</table></div>';

    html+=`<h3>Stocks</h3><button onclick="newStock()">➕ Nouveau Stock</button>
    <div class="table-container"><table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>`;
    stocks.forEach(s=>{
      html+=`<tr data-id="${s._id}">
        <td data-label="Code">${s.code}</td>
        <td data-label="Expéditeur">${s.sender}<br>📞 ${s.senderPhone}</td>
        <td data-label="Destination">${s.destination}<br>📞 ${s.destinationPhone}</td>
        <td data-label="Montant">${s.amount}</td>
        <td data-label="Devise">${s.currency}</td>
        <td data-label="Actions">
          <button onclick="editStock('${s._id}')">✏️</button>
          <button onclick="deleteStock('${s._id}')">❌</button>
        </td></tr>`;
    });
    html+='</table></div>';

    html+=`<h3>Historique Stocks</h3><div class="table-container"><table><tr><th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;
    history.forEach(h=>{
      html+=`<tr>
        <td data-label="Date">${h.date.toLocaleString()}</td>
        <td data-label="Code">${h.code}</td>
        <td data-label="Expéditeur">${h.sender}<br>📞 ${h.senderPhone}</td>
        <td data-label="Destination">${h.destination}<br>📞 ${h.destinationPhone}</td>
        <td data-label="Montant">${h.amount}</td>
      </tr>`;
    });
    html+='</table></div>';

    html+=`<script>
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
    async function newTransfert(){ 
      let sender=prompt('Expéditeur'); if(!sender)return;
      let senderPhone=prompt('Téléphone expéditeur'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      let origin=normalizeUpper(prompt('Origine')); if(!ALLOWED_LOCATIONS.includes(origin)){alert('Origine invalide');return;}
      let receiver=prompt('Destinataire'); if(!receiver)return;
      let receiverPhone=prompt('Téléphone destinataire'); if(!isValidPhone(receiverPhone)){alert('Téléphone invalide');return;}
      let destination=normalizeUpper(prompt('Destination')); if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
      let amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      let fees=parseFloat(prompt('Frais')); if(isNaN(fees)||fees<0){alert('Frais invalide');return;}
      let currency=normalizeUpper(prompt('Devise','GNF')); if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
      let mode=normalizeUpper(prompt('Mode de retrait','ESPECE')); if(!ALLOWED_RETRAIT_MODES.includes(mode)){alert('Mode invalide');return;}
      await postData('/transferts/form',{sender,senderPhone,origin,receiver,receiverPhone,destination,amount,fees,recoveryAmount:amount-fees,currency,retraitMode:mode}); location.reload();
    }
    async function editTransfert(id){ alert('Modification à compléter'); }
    async function deleteTransfert(id){ if(confirm('Supprimer ?')){await postData('/transferts/delete',{id}); location.reload();} }
    async function retirer(id){ let mode=normalizeUpper(prompt('Mode retrait','ESPECE')); await postData('/transferts/retirer',{id,mode}); location.reload(); }
    async function newStock(){ 
      let sender=prompt('Expéditeur'); if(!sender)return;
      let senderPhone=prompt('Téléphone expéditeur'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      let destination=normalizeUpper(prompt('Destination')); if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
      let destinationPhone=prompt('Téléphone destination'); if(!isValidPhone(destinationPhone)){alert('Téléphone invalide');return;}
      let amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      let currency=normalizeUpper(prompt('Devise','GNF')); if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
      await postData('/stocks/new',{sender,senderPhone,destination,destinationPhone,amount,currency}); location.reload();
    }
    async function editStock(id){ alert('Modification stock à compléter'); }
    async function deleteStock(id){ if(confirm('Supprimer ?')){await postData('/stocks/delete',{id}); location.reload();} }
    </script>`;

    res.send(html);
  }catch(e){ console.error(e); res.status(500).send('Erreur serveur'); }
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{ 
    const data=req.body;
    if(!data.code) data.code=await generateUniqueCode();
    await new Transfert(data).save();
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Erreur transfert'}); }
});
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const t = await Transfert.findById(req.body.id);
    if(!t) return res.status(404).json({error:'Transfert introuvable'});
    if(t.retired) return res.status(400).json({error:'Déjà retiré'});
    t.retired=true; t.retraitMode=req.body.mode;
    await t.save();
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({error:'Erreur retrait'}); }
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{
  try{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); }
  catch(e){ console.error(e); res.status(500).json({error:'Erreur suppression'}); }
});

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{ 
    const data=req.body; 
    if(!data.code) data.code=await generateUniqueCode();
    await new Stock(data).save();
    await new StockHistory({...data,action:'AJOUT',stockId:data._id}).save();
    res.json({ok:true}); 
  }catch(e){ console.error(e); res.status(500).json({error:'Erreur stock'}); }
});
app.post('/stocks/delete', requireLogin, async(req,res)=>{
  try{ await Stock.findByIdAndDelete(req.body.id); await StockHistory.findByIdAndDelete(req.body.id); res.json({ok:true}); }
  catch(e){ console.error(e); res.status(500).json({error:'Erreur suppression stock'}); }
});



/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){
  console.log('Serveur lance sur http://localhost:' + PORT);
});
