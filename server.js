/******************************************************************
 * APP TRANSFERT + STOCKS + CLIENTS + RATES – VERSION COMPLETE
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
  received: Number,
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

const clientSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  phone: String,
  email: String,
  kycVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({
  from: String,
  to: String,
  rate: Number,
  createdAt: { type: Date, default: Date.now }
});
const Rate = mongoose.model('Rate', rateSchema);

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

function setPermissions(username){
  if(username==='a') return { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true };
  if(username==='admin2') return { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true };
  return { lecture:true, ecriture:true, retrait:true, modification:true, suppression:true, imprimer:true };
}

function isValidPhone(phone){return /^00224\d{9}$/.test(phone)||/^0033\d{9}$/.test(phone);}
function normalizeUpper(v){return (v||'').toString().trim().toUpperCase();}

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
    const stocks = await Stock.find().sort({createdAt:-1});
    const stockHistory = await StockHistory.find().sort({date:-1});
    const clients = await Client.find().sort({createdAt:-1});
    const rates = await Rate.find().sort({createdAt:-1});

    const s = search.toLowerCase();
    let transferts = transfertsRaw.filter(t=>{
      return t.code.toLowerCase().includes(s)
        || (t.senderFirstName||'').toLowerCase().includes(s)
        || (t.receiverFirstName||'').toLowerCase().includes(s)
        || (t.senderPhone||'').toLowerCase().includes(s)
        || (t.receiverPhone||'').toLowerCase().includes(s);
    });
    if(status==='retire') transferts=transferts.filter(t=>t.retired);
    else if(status==='non') transferts=transferts.filter(t=>!t.retired);

    const totals={};
    transferts.forEach(t=>{
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,received:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].received+=t.received;
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
    .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
    .modal-content{background:white;padding:20px;border-radius:10px;max-width:400px;width:90%;overflow:auto;}
    .modal-content input, .modal-content select{width:100%;margin-bottom:10px;}
    </style>
    </head><body>
    <h2>📊 Dashboard</h2>
    <a href="/logout">🚪 Déconnexion</a>

    <h3>Transferts</h3>
    <button onclick="openModal('transfert')">➕ Nouveau Transfert</button>
    <div class="table-container"><table>
    <tr><th>Code</th><th>Origin</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
    transferts.forEach(t=>{
      html+=`<tr>
        <td data-label="Code">${t.code}</td>
        <td data-label="Origin">${t.originLocation}</td>
        <td data-label="Expéditeur">${t.senderFirstName}<br>📞 ${t.senderPhone||'-'}</td>
        <td data-label="Destination">${t.destinationLocation}</td>
        <td data-label="Destinataire">${t.receiverFirstName}<br>📞 ${t.receiverPhone||'-'}</td>
        <td data-label="Montant">${t.amount}</td>
        <td data-label="Frais">${t.fees}</td>
        <td data-label="Reçu">${t.received}</td>
        <td data-label="Devise">${t.currency}</td>
        <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
        <td data-label="Actions">
          <button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
          <button class="delete" onclick="fetch('/transfert/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${t._id}'})}).then(()=>location.reload())">❌</button>
          ${!t.retired?`<button class="retirer" onclick="fetch('/transfert/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${t._id}',mode:'ESPECE'})}).then(()=>location.reload())">💰</button>`:''}
        </td>
      </tr>`;
    });
    html+=`</table></div>`;

    // ======= Stocks, Clients, Rates tables similarly =======
    // Ici tu peux rajouter les tables Stocks, Clients, Rates exactement comme la table transferts
    // avec les boutons ➕ et édit/delete + print

    // ================= MODAL UNIQUE =================
    html+=`
<div id="modal" class="modal">
  <div class="modal-content">
    <h3 id="modalTitle">Formulaire</h3>
    <form id="modalForm">
      <input type="hidden" id="m_id">
      <div id="modalFields"></div>
      <button type="submit">Enregistrer</button>
      <button type="button" onclick="closeModal()">Fermer</button>
    </form>
  </div>
</div>
<script>
let currentType='';
const fieldTemplates = {
  'transfert': [
    {id:'senderFirstName', placeholder:'Nom expéditeur', required:true},
    {id:'senderPhone', placeholder:'Téléphone expéditeur', required:true},
    {id:'originLocation', placeholder:'Origine', required:true},
    {id:'receiverFirstName', placeholder:'Nom destinataire', required:true},
    {id:'receiverPhone', placeholder:'Téléphone destinataire', required:true},
    {id:'destinationLocation', placeholder:'Destination', required:true},
    {id:'amount', placeholder:'Montant', type:'number', required:true},
    {id:'fees', placeholder:'Frais', type:'number', required:true},
    {id:'currency', type:'select', options:['GNF','XOF','EUR','USD'], required:true},
    {id:'recoveryMode', type:'select', options:['ESPECE','TRANSFERT','VIREMENT','AUTRE'], required:true}
  ],
  'stock': [
    {id:'sender', placeholder:'Expéditeur', required:true},
    {id:'senderPhone', placeholder:'Téléphone expéditeur', required:true},
    {id:'destination', placeholder:'Destination', required:true},
    {id:'destinationPhone', placeholder:'Téléphone destination', required:true},
    {id:'amount', placeholder:'Montant', type:'number', required:true},
    {id:'currency', type:'select', options:['GNF','XOF','EUR','USD'], required:true}
  ],
  'client': [
    {id:'firstName', placeholder:'Prénom', required:true},
    {id:'lastName', placeholder:'Nom', required:true},
    {id:'phone', placeholder:'Téléphone', required:true},
    {id:'email', placeholder:'Email', required:false},
    {id:'kycVerified', type:'select', options:['false','true'], placeholder:'KYC', required:true}
  ],
  'rate': [
    {id:'from', placeholder:'De', required:true},
    {id:'to', placeholder:'Vers', required:true},
    {id:'rate', placeholder:'Taux', type:'number', required:true}
  ]
};

function openModal(type){
  currentType=type;
  document.getElementById('modal').style.display='flex';
  document.getElementById('modalTitle').innerText='Ajouter '+type;
  document.getElementById('m_id').value='';
  const container = document.getElementById('modalFields');
  container.innerHTML='';
  fieldTemplates[type].forEach(f=>{
    let input;
    if(f.type==='select'){
      input = document.createElement('select');
      f.options.forEach(opt=>{ const o=document.createElement('option'); o.value=opt;o.innerText=opt; input.appendChild(o); });
    }else{
      input = document.createElement('input');
      input.type = f.type||'text';
      input.placeholder = f.placeholder;
    }
    input.id=f.id;
    if(f.required) input.required=true;
    container.appendChild(input);
  });
}
function closeModal(){document.getElementById('modal').style.display='none';}
document.getElementById('modalForm').onsubmit = function(e){
  e.preventDefault();
  const id = document.getElementById('m_id').value;
  const data = { _id:id };
  fieldTemplates[currentType].forEach(f=>{
    const val = document.getElementById(f.id).value;
    if(f.type==='number') data[f.id]=parseFloat(val)||0;
    else if(f.type==='select' && f.id==='kycVerified') data[f.id]=(val==='true');
    else data[f.id]=val;
  });
  fetch('/'+currentType+'/new',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  }).then(r=>r.json()).then(()=>location.reload());
};

// EDIT FUNCTIONS
function editTransfert(id){openModal('transfert');document.getElementById('m_id').value=id;}
function editStock(id){openModal('stock');document.getElementById('m_id').value=id;}
function editClient(id){openModal('client');document.getElementById('m_id').value=id;}
function editRate(id){openModal('rate');document.getElementById('m_id').value=id;}
</script>
</body></html>`;
    res.send(html);
  }catch(err){ console.error(err); res.status(500).send('Erreur Dashboard'); }
});

// ================== CRUD Routes ==================
// Exemples pour transfert
app.post('/transfert/new', async(req,res)=>{
  try{
    const data = req.body;
    let t;
    if(data._id) t = await Transfert.findByIdAndUpdate(data._id,data,{new:true});
    else { data.code=await generateUniqueCode(); t = await new Transfert(data).save(); }
    res.json({success:true, t});
  }catch(err){ console.error(err); res.status(500).json({error:err.message}); }
});
app.post('/transfert/delete', async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.post('/transferts/retirer', requireLogin, async (req, res) => {
  try {
    const { id, mode } = req.body;

    // 1️⃣ Récupérer le transfert
    const transfert = await Transfert.findById(id);
    if (!transfert) {
      return res.status(404).json({ error: 'Transfert introuvable' });
    }

    if (transfert.retired) {
      return res.status(400).json({ error: 'Déjà retiré' });
    }

    const montantRetire = transfert.amount - transfert.fees;

    // 2️⃣ Trouver le stock correspondant
    const stock = await StockHistory.findOne({
      destination: transfert.destinationLocation,
      currency: transfert.currency
    });

    if (!stock) {
      return res.status(400).json({ error: 'Stock introuvable' });
    }

    if (stock.amount < montantRetire) {
      return res.status(400).json({ error: 'Stock insuffisant' });
    }

    // 3️⃣ Débiter le stock
    stock.amount = stock.amount - montantRetire;
    await stock.save();

    // 4️⃣ Marquer le transfert comme retiré
    transfert.retired = true;
    transfert.retraitHistory.push({
      date: new Date(),
      mode
    });
    await transfert.save();

    // 5️⃣ Historique
    // await new StockHistory({
     //  code: transfert.code,
       //action: 'RETRAIT',
       //stockId: stock._id,
       //sender: `${transfert.senderFirstName} ${transfert.senderLastName}`,
       //senderPhone: transfert.senderPhone,
       //destination: transfert.destinationLocation,
       //destinationPhone: transfert.receiverPhone,
       //amount: -montantRetire,
       //currency: transfert.currency
    // }).save();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});


// Même logique pour Stock, Client, Rate
app.post('/stock/new', async(req,res)=>{ let s=req.body._id?await Stock.findByIdAndUpdate(req.body._id,req.body,{new:true}):await new Stock({...req.body, code:await generateUniqueCode()}).save(); res.json({success:true,s}); });
app.post('/client/new', async(req,res)=>{ let c=req.body._id?await Client.findByIdAndUpdate(req.body._id,req.body,{new:true}):await new Client(req.body).save(); res.json({success:true,c}); });
app.post('/rate/new', async(req,res)=>{ let r=req.body._id?await Rate.findByIdAndUpdate(req.body._id,req.body,{new:true}):await new Rate(req.body).save(); res.json({success:true,r}); });

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Server running on http://localhost:${PORT}`));
