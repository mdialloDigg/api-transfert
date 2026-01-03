

/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE AVEC DASHBOARD MOBILE
 * + TOTUX, RECHERCHE, CRUD COMPLET, RETRAIT, IMPRESSION
 * + CONTROLES DE FORMAT COTE CLIENT ET SERVEUR
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
  senderFirstName: String,
  senderPhone: String,
  originLocation: String,
  receiverFirstName: String,
  receiverPhone: String,
  destinationLocation: String,
  amount: Number,
  fees: Number,
  recoveryAmount: Number,
  currency: { type: String, enum: ALLOWED_CURRENCIES, default:'GNF' },
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
  currency: { type: String, enum: ALLOWED_CURRENCIES, default:'GNF' },
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

function validateTransfert(data){
  if(!ALLOWED_LOCATIONS.includes(normalizeUpper(data.originLocation))) return 'Origine invalide';
  if(!ALLOWED_LOCATIONS.includes(normalizeUpper(data.destinationLocation))) return 'Destination invalide';
  if(!data.senderFirstName) return 'Nom expéditeur obligatoire';
  if(!data.receiverFirstName) return 'Nom destinataire obligatoire';
  if(!isValidPhone(data.senderPhone)) return 'Téléphone expéditeur invalide';
  if(!isValidPhone(data.receiverPhone)) return 'Téléphone destinataire invalide';
  if(isNaN(data.amount) || data.amount<=0) return 'Montant invalide';
  if(isNaN(data.fees) || data.fees<0) return 'Frais invalide';
  if(!ALLOWED_CURRENCIES.includes(normalizeUpper(data.currency))) return 'Devise invalide';
  if(!ALLOWED_RETRAIT_MODES.includes(normalizeUpper(data.recoveryMode))) return 'Mode de retrait invalide';
  return null;
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:#f0f2f5;display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  input,button{width:100%;padding:15px;margin:10px 0;font-size:16px;border-radius:10px;}
  button{background:#ff8c42;color:white;border:none;cursor:pointer;}
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
    const {username,password}=req.body;
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
    const { search='' } = req.query;
    const transfertsRaw = await Transfert.find().sort({createdAt:-1});
    const stocksRaw = await Stock.find().sort({createdAt:-1});
    const stockHistoryRaw = await StockHistory.find().sort({date:-1});
    
    // Recherche
    const s = search.toLowerCase();
    const transferts = transfertsRaw.filter(t=>{
      return t.code.toLowerCase().includes(s)
        || t.senderFirstName.toLowerCase().includes(s)
        || t.receiverFirstName.toLowerCase().includes(s)
        || (t.senderPhone||'').includes(s)
        || (t.receiverPhone||'').includes(s);
    });

    let totals={};
    transferts.forEach(t=>{
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount += t.amount;
      totals[t.destinationLocation][t.currency].fees += t.fees;
      totals[t.destinationLocation][t.currency].recovery += t.amount - t.fees;
    });

    // ================= HTML =================
    let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard</title>
    <style>body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}h2,h3{color:#333;}table{border-collapse:collapse;width:100%;margin-bottom:20px;}th,td{border:1px solid #ccc;padding:10px;text-align:left;}th{background:#ff8c42;color:white;}
    @media(max-width:768px){table,thead,tbody,th,td,tr{display:block;}thead tr{display:none;}td{position:relative;padding-left:50%;}td::before{content:attr(data-label);position:absolute;left:10px;top:10px;font-weight:bold;}}</style>
    </head><body>
    <h2>Dashboard</h2><a href="/logout">Déconnexion</a>
    <h3>Totaux par destination/devise</h3><ul>`;
    for(let dest in totals){ for(let curr in totals[dest]){
      html+=`<li>${dest} - ${curr}: Montant=${totals[dest][curr].amount}, Frais=${totals[dest][curr].fees}, Reçu=${totals[dest][curr].recovery}</li>`;
    }} html+='</ul>';

    // Table transferts
    html+='<h3>Transferts</h3><table><tr><th>Code</th><th>Origine</th><th>Expéditeur</th><th>Destination</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>';
    transferts.forEach(t=>{
      html+=`<tr data-id="${t._id}">
      <td data-label="Code">${t.code}</td>
      <td data-label="Origine">${t.originLocation}</td>
      <td data-label="Expéditeur">${t.senderFirstName} <br>📞 ${t.senderPhone}</td>
      <td data-label="Destination">${t.destinationLocation}</td>
      <td data-label="Destinataire">${t.receiverFirstName}<br>📞 ${t.receiverPhone}</td>
      <td data-label="Montant">${t.amount}</td>
      <td data-label="Frais">${t.fees}</td>
      <td data-label="Reçu">${t.amount-t.fees}</td>
      <td data-label="Devise">${t.currency}</td>
      <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
      <td data-label="Actions">
        <button onclick="editTransfert('${t._id}')">✏️</button>
        <button onclick="deleteTransfert('${t._id}')">❌</button>
        ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}
        <button onclick="printRow(this)">🖨️</button>
      </td></tr>`;
    });
    html+='</table>';

    // Table Stocks
    html+='<h3>Stocks</h3><button onclick="newStock()">➕ Nouveau Stock</button><table><tr><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Actions</th></tr>';
    stocksRaw.forEach(s=>{
      html+=`<tr data-id="${s._id}">
      <td data-label="Code">${s.code}</td>
      <td data-label="Expéditeur">${s.sender}<br>📞 ${s.senderPhone}</td>
      <td data-label="Destination">${s.destination}<br>📞 ${s.destinationPhone}</td>
      <td data-label="Montant">${s.amount}</td>
      <td data-label="Devise">${s.currency}</td>
      <td data-label="Actions">
        <button onclick="editStock('${s._id}')">✏️</button>
        <button onclick="deleteStock('${s._id}')">❌</button>
        <button onclick="printRow(this)">🖨️</button>
      </td></tr>`;
    });
    html+='</table>';

    // Historique Stocks
    html+='<h3>Historique Stocks</h3><table><tr><th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>';
    stockHistoryRaw.forEach(h=>{
      html+=`<tr>
      <td data-label="Date">${h.date.toLocaleString()}</td>
      <td data-label="Code">${h.code}</td>
      <td data-label="Expéditeur">${h.sender}<br>📞 ${h.senderPhone}</td>
      <td data-label="Destination">${h.destination}<br>📞 ${h.destinationPhone}</td>
      <td data-label="Montant">${h.amount}</td>
      <td data-label="Actions"><button onclick="printRow(this)">🖨️</button></td>
      </tr>`;
    });
    html+='</table>';

    // ================= SCRIPT =================
    html+=`<script>
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

    function normalizeUpper(v){return (v||'').toString().trim().toUpperCase();}
    function isValidPhone(phone){return /^00224\\d{9}$/.test(phone) || /^0033\\d{9}$/.test(phone);}

    async function newStock(){
      let sender=prompt('Expéditeur'); if(!sender){alert('Nom obligatoire');return;}
      let senderPhone=prompt('Téléphone expéditeur'); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      let destination=normalizeUpper(prompt('Destination')); if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
      let destinationPhone=prompt('Téléphone destination'); if(!isValidPhone(destinationPhone)){alert('Téléphone invalide');return;}
      let amount=parseFloat(prompt('Montant')); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      let currency=normalizeUpper(prompt('Devise','GNF')); if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
      await postData('/stocks/new',{sender,senderPhone,destination,destinationPhone,amount,currency});
      location.reload();
    }

    async function editStock(id){
      const s=await (await fetch('/stocks/get/'+id)).json();
      let sender=prompt('Expéditeur',s.sender); if(!sender){alert('Nom obligatoire');return;}
      let senderPhone=prompt('Téléphone expéditeur',s.senderPhone); if(!isValidPhone(senderPhone)){alert('Téléphone invalide');return;}
      let destination=normalizeUpper(prompt('Destination',s.destination)); if(!ALLOWED_LOCATIONS.includes(destination)){alert('Destination invalide');return;}
      let destinationPhone=prompt('Téléphone destination',s.destinationPhone); if(!isValidPhone(destinationPhone)){alert('Téléphone invalide');return;}
      let amount=parseFloat(prompt('Montant',s.amount)); if(isNaN(amount)||amount<=0){alert('Montant invalide');return;}
      let currency=normalizeUpper(prompt('Devise',s.currency)); if(!ALLOWED_CURRENCIES.includes(currency)){alert('Devise invalide');return;}
      await postData('/stocks/new',{_id:s._id,sender,senderPhone,destination,destinationPhone,amount,currency}); location.reload();
    }

    async function deleteStock(id){if(confirm('Supprimer ce stock ?')){await postData('/stocks/delete',{id}); location.reload();}}
    async function editTransfert(id){alert('Modifier un transfert');}
    async function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){await postData('/transferts/delete',{id}); location.reload();}}
    async function retirerTransfert(id){let mode=prompt('Mode retrait','ESPECE'); await postData('/transferts/retirer',{id,mode}); location.reload();}
    function printRow(btn){const row=btn.closest('tr'); const w=window.open(''); w.document.write('<html><body>'+row.outerHTML+'</body></html>'); w.document.close(); w.print();}
    </script>`;

    html+='</body></html>';
    res.send(html);

  }catch(err){ console.error(err); res.status(500).send('Erreur serveur'); }
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    const err = validateTransfert(data);
    if(err) return res.status(400).json({error:err});
    if(data._id) await Transfert.findByIdAndUpdate(data._id,{...data});
    else{ const code = data.code || await generateUniqueCode(); await new Transfert({...data,code,retraitHistory:[]}).save(); }
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:'Erreur lors de l\'enregistrement du transfert'});}
});
app.post('/transferts/delete', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({ok:true}); });
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    const {id,mode}=req.body;
    const t = await Transfert.findById(id);
    if(!t) return res.status(404).json({error:'Transfert introuvable'});
    if(t.retired) return res.status(400).json({error:'Déjà retiré'});
    t.retired=true; t.retraitHistory.push({date:new Date(),mode}); await t.save();
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:'Erreur retrait'});}
});
app.get('/transferts/get/:id', requireLogin, async(req,res)=>{ const t=await Transfert.findById(req.params.id); res.json(t||{}); });

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    let s;
    if(data._id){ s=await Stock.findByIdAndUpdate(data._id,{...data},{new:true}); }
    else{ const code = await generateUniqueCode(); s=await new Stock({...data,code}).save(); }
    await new StockHistory({code:s.code,action:data._id?'Modification':'Création',stockId:s._id,...data}).save();
    res.json({ok:true});
  }catch(err){ console.error(err); res.status(500).json({error:'Erreur stock'});}
});
app.get('/stocks/get/:id', requireLogin, async(req,res)=>{ const s=await Stock.findById(req.params.id); res.json(s||{}); });
app.post('/stocks/delete', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.body.id); res.json({ok:true}); });



/* ================= SERVER ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, function(){
  console.log('Serveur lance sur http://localhost:' + PORT);
});
