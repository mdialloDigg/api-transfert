/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION COMPLETE AVEC MOBILE ET IMPRIMER
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
    const stocks = await Stock.find().sort({createdAt:-1});
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
    <form method="get" action="/dashboard">
      <input type="text" name="search" placeholder="Recherche..." value="${search}">
      <select name="status">
        <option value="all" ${status==='all'?'selected':''}>Tous</option>
        <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
        <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
      </select>
      <button type="submit">🔍 Filtrer</button>
      ${req.session.user.permissions.ecriture?'<button type="button" onclick="newTransfert()">➕ Nouveau Transfert</button>':''}
    </form>`;

    // Totaux
    html+=`<h4>Totaux par destination/devise</h4>
    <div class="table-container"><table>
    <thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
    for(let dest in totals){
      for(let curr in totals[dest]){
        html+=`<tr>
          <td data-label="Destination">${dest}</td>
          <td data-label="Devise">${curr}</td>
          <td data-label="Montant">${totals[dest][curr].amount}</td>
          <td data-label="Frais">${totals[dest][curr].fees}</td>
          <td data-label="Reçu">${totals[dest][curr].recovery}</td>
        </tr>`;
      }
    }
    html+=`</tbody></table></div>`;

    // =================== Table Transferts ===================
    html+=`<div class="table-container"><table>
    <tr><th>Code</th><th>Origin Location</th><th>Expéditeur</th><th>Destination Location</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;
    transferts.forEach(t=>{
      html+=`<tr data-id="${t._id}">
        <td data-label="Code">${t.code}</td>
        <td data-label="Origin Location">${t.originLocation}</td>
        <td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName}<br>📞 ${t.senderPhone || '-'}</td>
        <td data-label="Destination Location">${t.destinationLocation}</td>
        <td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName}<br>📞 ${t.receiverPhone || '-'}</td>
        <td data-label="Montant">${t.amount}</td>
        <td data-label="Frais">${t.fees}</td>
        <td data-label="Reçu">${t.amount - t.fees}</td>
        <td data-label="Devise">${t.currency}</td>
        <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
        <td data-label="Actions">
          ${req.session.user.permissions.modification?`<button class="modify" onclick="editTransfert('${t._id}')">✏️</button>`:''}
          ${req.session.user.permissions.suppression?`<button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>`:''}
          ${!t.retired && req.session.user.permissions.retrait?`
<button class="retirer" onclick="window.retirerTransfert('${t._id}')">💰</button>

`:''}



          <button class="print" onclick="printRow(this)">🖨️</button>
        </td>
      </tr>`;
    });
    html+=`</table></div>`;

    // =================== Table Stocks ===================
 html+=`<h3>Stocks</h3>`;
if(req.session.user.permissions.ecriture){
  html+=`<button type="button" onclick="newStock()">➕ Nouveau Stock</button>`;
}





    // =================== Table Historique Stocks ===================
    html+=`<h3>Historique Stocks</h3>
    <div class="table-container"><table>
    <tr><th>Date</th><th>Code</th><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;
    stockHistory.forEach(h=>{
      html+=`<tr>
        <td data-label="Date">${h.date.toLocaleString()}</td>
        <td data-label="Code">${h.code}</td>
        <td data-label="Expéditeur">${h.sender}<br>📞 ${h.senderPhone || '-'}</td>
        <td data-label="Destination">${h.destination}<br>📞 ${h.destinationPhone || '-'}</td>
        <td data-label="Montant">${h.amount}</td>
        <td data-label="Actions">
          ${req.session.user.permissions.modification?`<button class="modify" onclick="editStock('${h._id}')">✏️</button>`:''}
          ${req.session.user.permissions.suppression?`<button class="delete" onclick="deleteStock('${h._id}')">❌</button>`:''}
          <button class="print" onclick="printRow(this)">🖨️</button>
        </td>
      </tr>`;
    });
    html+=`</table></div>`;

    // =================== SCRIPT ==================
    html+=`<script>
    async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

    function newTransfert() {const originLocation=prompt('Origine'); const sender=prompt('Expéditeur'); const senderPhone=prompt('Téléphone expéditeur'); const destinationLocation=prompt('Destination');const receiver=prompt('Destinataire'); const receiverPhone=prompt('Téléphone destinataire'); const amount=parseFloat(prompt('Montant')); const currency=prompt('Devise','GNF'); if(sender && receiver && amount) 

postData('/transferts/form',{originLocation: originLocation,senderFirstName: sender,senderPhone,destinationLocation: destinationLocation,receiverFirstName:receiver,receiverPhone,amount,fees:parseFloat(prompt('frais')),recoveryAmount:amount,currency,userType:'Client'}).then(()=>location.reload());}


    async function editTransfert(id){const t=await (await fetch('/transferts/get/'+id)).json(); const sender=prompt('Expéditeur',t.senderFirstName)||t.senderFirstName; const senderPhone=prompt('Téléphone expéditeur',t.senderPhone)||t.senderPhone; const receiver=prompt('Destinataire',t.receiverFirstName)||t.receiverFirstName; const receiverPhone=prompt('Téléphone destinataire',t.receiverPhone)||t.receiverPhone; const amount=parseFloat(prompt('Montant',t.amount))||t.amount; const currency=prompt('Devise',t.currency)||t.currency; await postData('/transferts/form',{_id:t._id,senderFirstName:sender,senderPhone,receiverFirstName:receiver,receiverPhone,amount,currency}); location.reload();}
    async function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){await postData('/transferts/delete',{id}); location.reload();}}
async function retirerTransfert(id){const mode=prompt('Mode de retrait','Espèces');if(!mode)return;const res=await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});const data=await res.json();if(!res.ok){alert(data.error||'Erreur lors du retrait');return;}alert('✅ Retrait effectué avec succès');location.reload();}

      function newStock() {const sender=prompt('Expéditeur'); const senderPhone=prompt('Téléphone expéditeur'); const destination=prompt('Destination'); const destinationPhone=prompt('Téléphone destination'); const amount=parseFloat(prompt('Montant')); const currency=prompt('Devise','GNF'); if(sender && destination && amount) postData('/stocks/new',{sender,senderPhone,destination,destinationPhone,amount,currency}).then(()=>location.reload());}
    async function editStock(id){const s=await (await fetch('/stocks/get/'+id)).json(); const sender=prompt('Expéditeur',s.sender)||s.sender; const senderPhone=prompt('Téléphone expéditeur',s.senderPhone)||s.senderPhone; const destination=prompt('Destination',s.destination)||s.destination; const destinationPhone=prompt('Téléphone destination',s.destinationPhone)||s.destinationPhone; const amount=parseFloat(prompt('Montant',s.amount))||s.amount; const currency=prompt('Devise',s.currency)||s.currency; await postData('/stocks/new',{_id:s._id,sender,senderPhone,destination,destinationPhone,amount,currency}); location.reload();}
    


async function deleteStock(id){if(!confirm('Supprimer ce stock ?'))return;const r=await fetch('/stocks/delete',{method:'POST',headers:{'Content Type':'application/json'},body:JSON.stringify({id})});const d=await r.json();if(!r.ok){alert(d.error||'Erreur suppression');return;}alert('✅ Stock supprimé');location.reload();}


    function printRow(btn){const row=btn.closest('tr'); const newWin=window.open(''); newWin.document.write('<html><head><title>Impression</title></head><body>'); newWin.document.write('<table border="1" style="border-collapse:collapse; font-family:Arial; padding:10px;">'); newWin.document.write(row.outerHTML); newWin.document.write('</table></body></html>'); newWin.document.close(); newWin.print(); newWin.close();}
    </script>`;

    html+='</body></html>';
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
    stock.amount = - montantRetire;
    await stock.save();

    // 4️⃣ Marquer le transfert comme retiré
    transfert.retired = true;
    transfert.retraitHistory.push({
      date: new Date(),
      mode
    });
    await transfert.save();

    // 5️⃣ Historique
    await new StockHistory({
      code: transfert.code,
      action: 'RETRAIT',
      stockId: stock._id,
      sender: `${transfert.senderFirstName} ${transfert.senderLastName}`,
      senderPhone: transfert.senderPhone,
      destination: transfert.destinationLocation,
      destinationPhone: transfert.receiverPhone,
      amount: stock.amount,
      currency: transfert.currency
    }).save();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
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
