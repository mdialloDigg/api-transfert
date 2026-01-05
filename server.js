require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended:true }));
app.use(express.json());

/* ================= SESSION ================= */
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*8 }
}));

/* ================= DATABASE ================= */
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert_app';
mongoose.connect(mongoUri)
  .then(()=>console.log('✅ MongoDB connected'))
  .catch(err=>{ console.error('❌ MongoDB error:', err.message); process.exit(1); });

/* ================= SCHEMAS ================= */
const transfertSchema = new mongoose.Schema({
  userType:{type:String,enum:['Client','Distributeur','Administrateur','Agence'],required:true},
  sender:String, senderPhone:String,
  receiver:String, receiverPhone:String,
  originLocation:String, destinationLocation:String,
  amount:Number, fees:Number, received:Number,
  currency:{type:String,enum:['GNF','EUR','USD','XOF'],default:'GNF'},
  recoveryMode:String,
  retraitHistory:[{date:Date,mode:String}],
  retired:{type:Boolean,default:false},
  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const stockSchema = new mongoose.Schema({
  code:{type:String,unique:true},
  sender:String, senderPhone:String,
  destination:String, destinationPhone:String,
  amount:Number,
  currency:{type:String,default:'GNF'},
  createdAt:{type:Date,default:Date.now}
});
const Stock = mongoose.model('Stock',stockSchema);

const clientSchema = new mongoose.Schema({
  firstName:String, lastName:String,
  phone:String, email:String,
  kycVerified:{type:Boolean,default:false},
  createdAt:{type:Date,default:Date.now}
});
const Client = mongoose.model('Client',clientSchema);

const rateSchema = new mongoose.Schema({
  from:String, to:String, rate:Number, createdAt:{type:Date,default:Date.now}
});
const Rate = mongoose.model('Rate',rateSchema);

const authSchema = new mongoose.Schema({
  username:String, password:String,
  role:{type:String,enum:['admin','agent'],default:'agent'}
});
const Auth = mongoose.model('Auth',authSchema);

/* ================= UTILS ================= */
async function generateUniqueCode() {
  let code, exists=true;
  while(exists){
    const letter = String.fromCharCode(65+Math.floor(Math.random()*26));
    const number = Math.floor(100+Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

function setPermissions(username){
  if(username==='a') return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
  if(username==='admin2') return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;font-family:Arial;background:#f0f2f5;display:flex;justify-content:center;align-items:center;height:100vh;}
    .login{background:white;padding:30px;border-radius:15px;box-shadow:0 5px 20px rgba(0,0,0,0.2);}
    input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:1px solid #ccc;}
    button{width:100%;padding:10px;background:#ff8c42;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;}
    button:hover{background:#e67300;}
  </style>
  </head><body>
    <div class="login">
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
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = {username:user.username, role:user.role, permissions:setPermissions(username)};
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

/* ================= DASHBOARD ================= */
app.get('/dashboard', requireLogin, async(req,res)=>{
  const p = req.session.user.permissions;

  let html=`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
    h2,h3{color:#333;}
    table{border-collapse:collapse;width:100%;margin-bottom:20px;}
    th,td{border:1px solid #ccc;padding:8px;text-align:left;}
    th{background:#ff8c42;color:white;}
    button{margin:2px;padding:5px 8px;cursor:pointer;}
    .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
    .modal-content{background:white;padding:20px;border-radius:10px;max-width:500px;width:90%;}
    input,select{width:100%;padding:6px;margin-bottom:10px;}
  </style>
  </head><body>
  <h2>Dashboard</h2>
  <a href="/logout">Déconnexion</a>

  <h3>Transferts</h3>
  <button onclick="openTransfertModal()">Nouveau Transfert</button>
  <table id="transfertTable"><tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Montant</th><th>Status</th><th>Actions</th></tr></table>

  <h3>Stocks</h3>
  <button onclick="openStockModal()">Nouveau Stock</button>
  <table id="stockTable"><tr><th>Code</th><th>Sender</th><th>Destination</th><th>Montant</th><th>Actions</th></tr></table>

  <h3>Clients</h3>
  <button onclick="openClientModal()">Nouveau Client</button>
  <table id="clientTable"><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr></table>

  <h3>Taux</h3>
  <button onclick="openRateModal()">Nouveau Taux</button>
  <table id="rateTable"><tr><th>From</th><th>To</th><th>Rate</th><th>Actions</th></tr></table>

  <!-- MODALS -->
  <div id="transfertModal" class="modal">
    <div class="modal-content">
      <h3>Transfert</h3>
      <input id="t_code" readonly placeholder="Code">
      <input id="t_sender" placeholder="Expéditeur">
      <input id="t_senderPhone" placeholder="Téléphone Expéditeur">
      <input id="t_receiver" placeholder="Destinataire">
      <input id="t_receiverPhone" placeholder="Téléphone Destinataire">
      <input id="t_origin" placeholder="Lieu d'origine">
      <input id="t_destination" placeholder="Lieu de destination">
      <input id="t_amount" type="number" placeholder="Montant">
      <input id="t_fees" type="number" placeholder="Frais">
      <input id="t_received" type="number" placeholder="Montant reçu">
      <select id="t_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
      <input id="t_recovery" placeholder="Mode de récupération">
      <button onclick="saveTransfert()">Enregistrer</button>
      <button onclick="closeTransfertModal()">Fermer</button>
    </div>
  </div>

  <div id="stockModal" class="modal">
    <div class="modal-content">
      <h3>Stock</h3>
      <input id="s_code" readonly placeholder="Code">
      <input id="s_sender" placeholder="Sender">
      <input id="s_senderPhone" placeholder="Sender Phone">
      <input id="s_destination" placeholder="Destination">
      <input id="s_destinationPhone" placeholder="Destination Phone">
      <input id="s_amount" type="number" placeholder="Montant">
      <select id="s_currency"><option>GNF</option><option>XOF</option><option>EUR</option><option>USD</option></select>
      <button onclick="saveStock()">Enregistrer</button>
      <button onclick="closeStockModal()">Fermer</button>
    </div>
  </div>

  <div id="clientModal" class="modal">
    <div class="modal-content">
      <h3>Client</h3>
      <input id="c_firstName" placeholder="Prénom">
      <input id="c_lastName" placeholder="Nom">
      <input id="c_phone" placeholder="Téléphone">
      <input id="c_email" placeholder="Email">
      <select id="c_kyc"><option value="true">KYC Vérifié</option><option value="false">Non vérifié</option></select>
      <button onclick="saveClient()">Enregistrer</button>
      <button onclick="closeClientModal()">Fermer</button>
    </div>
  </div>

  <div id="rateModal" class="modal">
    <div class="modal-content">
      <h3>Rate</h3>
      <input id="r_from" placeholder="From">
      <input id="r_to" placeholder="To">
      <input id="r_rate" type="number" placeholder="Rate">
      <button onclick="saveRate()">Enregistrer</button>
      <button onclick="closeRateModal()">Fermer</button>
    </div>
  </div>

  <script>
    let currentTransfertId=null, currentStockId=null, currentClientId=null, currentRateId=null;

    async function postData(url,data){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); return r.json(); }

    // Transferts
    async function loadTransferts(){
      const data = await (await fetch('/api/transferts')).json();
      const table = document.getElementById('transfertTable');
      table.innerHTML='<tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Montant</th><th>Status</th><th>Actions</th></tr>';
      data.forEach(t=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`
          <td>\${t.code}</td>
          <td>\${t.sender}</td>
          <td>\${t.receiver}</td>
          <td>\${t.amount}</td>
          <td>\${t.retired?'Retiré':'Non retiré'}</td>
          <td>
            <button onclick="editTransfert('\${t._id}')">✏️</button>
            <button onclick="deleteTransfert('\${t._id}')">❌</button>
            <button onclick="retirerTransfert('\${t._id}')">💰</button>
            <button onclick="printTransfert('\${t._id}')">🖨</button>
          </td>\`;
        table.appendChild(tr);
      });
    }
    function openTransfertModal(id=null){currentTransfertId=id;document.getElementById('transfertModal').style.display='flex';}
    function closeTransfertModal(){document.getElementById('transfertModal').style.display='none';currentTransfertId=null;}
    async function saveTransfert(){
      const data={_id:currentTransfertId,sender:document.getElementById('t_sender').value,senderPhone:document.getElementById('t_senderPhone').value,
        receiver:document.getElementById('t_receiver').value,receiverPhone:document.getElementById('t_receiverPhone').value,
        originLocation:document.getElementById('t_origin').value,destinationLocation:document.getElementById('t_destination').value,
        amount:parseFloat(document.getElementById('t_amount').value),fees:parseFloat(document.getElementById('t_fees').value),
        received:parseFloat(document.getElementById('t_received').value),currency:document.getElementById('t_currency').value,
        recoveryMode:document.getElementById('t_recovery').value
      };
      await postData('/transfert/save',data); closeTransfertModal(); loadTransferts();
    }
    async function deleteTransfert(id){if(confirm('Supprimer ?')){await postData('/transfert/delete',{id});loadTransferts();}}
    async function retirerTransfert(id){if(confirm('Retirer ?')){await postData('/transfert/retirer',{id,mode:'ESPECE'});loadTransferts();}}
    function editTransfert(id){openTransfertModal(id);}
    function printTransfert(id){window.open('/transfert/print/'+id,'_blank');}

    // Stocks
    async function loadStocks(){
      const data = await (await fetch('/api/stocks')).json();
      const table = document.getElementById('stockTable');
      table.innerHTML='<tr><th>Code</th><th>Sender</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>';
      data.forEach(s=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`
          <td>\${s.code}</td><td>\${s.sender}</td><td>\${s.destination}</td><td>\${s.amount}</td>
          <td>
            <button onclick="editStock('\${s._id}')">✏️</button>
            <button onclick="deleteStock('\${s._id}')">❌</button>
          </td>\`;
        table.appendChild(tr);
      });
    }
    function openStockModal(id=null){currentStockId=id;document.getElementById('stockModal').style.display='flex';}
    function closeStockModal(){document.getElementById('stockModal').style.display='none';currentStockId=null;}
    async function saveStock(){
      const data={_id:currentStockId,sender:document.getElementById('s_sender').value,senderPhone:document.getElementById('s_senderPhone').value,
        destination:document.getElementById('s_destination').value,destinationPhone:document.getElementById('s_destinationPhone').value,
        amount:parseFloat(document.getElementById('s_amount').value),currency:document.getElementById('s_currency').value
      };
      await postData('/stock/save',data); closeStockModal(); loadStocks();
    }
    async function deleteStock(id){if(confirm('Supprimer ?')){await postData('/stock/delete',{id});loadStocks();}}
    function editStock(id){openStockModal(id);}

    // Clients
    async function loadClients(){
      const data = await (await fetch('/api/clients')).json();
      const table = document.getElementById('clientTable');
      table.innerHTML='<tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>KYC</th><th>Actions</th></tr>';
      data.forEach(c=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`
          <td>\${c.firstName} \${c.lastName}</td><td>\${c.phone}</td><td>\${c.email}</td><td>\${c.kycVerified?'Oui':'Non'}</td>
          <td>
            <button onclick="editClient('\${c._id}')">✏️</button>
            <button onclick="deleteClient('\${c._id}')">❌</button>
          </td>\`;
        table.appendChild(tr);
      });
    }
    function openClientModal(id=null){currentClientId=id;document.getElementById('clientModal').style.display='flex';}
    function closeClientModal(){document.getElementById('clientModal').style.display='none';currentClientId=null;}
    async function saveClient(){
      const data={_id:currentClientId,firstName:document.getElementById('c_firstName').value,lastName:document.getElementById('c_lastName').value,
        phone:document.getElementById('c_phone').value,email:document.getElementById('c_email').value,
        kycVerified:document.getElementById('c_kyc').value==='true'};
      await postData('/client/save',data); closeClientModal(); loadClients();
    }
    async function deleteClient(id){if(confirm('Supprimer ?')){await postData('/client/delete',{id});loadClients();}}
    function editClient(id){openClientModal(id);}

    // Rates
    async function loadRates(){
      const data = await (await fetch('/api/rates')).json();
      const table = document.getElementById('rateTable');
      table.innerHTML='<tr><th>From</th><th>To</th><th>Rate</th><th>Actions</th></tr>';
      data.forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`
          <td>\${r.from}</td><td>\${r.to}</td><td>\${r.rate}</td>
          <td>
            <button onclick="editRate('\${r._id}')">✏️</button>
            <button onclick="deleteRate('\${r._id}')">❌</button>
          </td>\`;
        table.appendChild(tr);
      });
    }
    function openRateModal(id=null){currentRateId=id;document.getElementById('rateModal').style.display='flex';}
    function closeRateModal(){document.getElementById('rateModal').style.display='none';currentRateId=null;}
    async function saveRate(){
      const data={_id:currentRateId,from:document.getElementById('r_from').value,to:document.getElementById('r_to').value,
        rate:parseFloat(document.getElementById('r_rate').value)};
      await postData('/rate/save',data); closeRateModal(); loadRates();
    }
    async function deleteRate(id){if(confirm('Supprimer ?')){await postData('/rate/delete',{id});loadRates();}}
    function editRate(id){openRateModal(id);}

    window.onload=()=>{
      loadTransferts(); loadStocks(); loadClients(); loadRates();
    };
  </script>
  </body></html>`;
  res.send(html);
});

/* ================== API TRANSFERT ================== */
app.get('/api/transferts', requireLogin, async(req,res)=>{ const t = await Transfert.find().sort({createdAt:-1}); res.json(t); });
app.post('/transfert/save', requireLogin, async(req,res)=>{
  const {_id,...data} = req.body;
  if(_id){ await Transfert.findByIdAndUpdate(_id,data); }
  else{ data.code = await generateUniqueCode(); data.userType='Client'; await new Transfert(data).save(); }
  res.json({success:true});
});
app.post('/transfert/delete', requireLogin, async(req,res)=>{ await Transfert.findByIdAndDelete(req.body.id); res.json({success:true}); });
app.post('/transfert/retirer', requireLogin, async(req,res)=>{ const t=await Transfert.findById(req.body.id); t.retired=true; await t.save(); res.json({success:true}); });
app.get('/transfert/print/:id', requireLogin, async(req,res)=>{ const t=await Transfert.findById(req.params.id); res.send(`<html><body><h2>Transfert ${t.code}</h2><p>Sender: ${t.sender}</p><p>Receiver: ${t.receiver}</p><p>Amount: ${t.amount}</p></body></html>`); });

/* ================== API STOCK ================== */
app.get('/api/stocks', requireLogin, async(req,res)=>{ res.json(await Stock.find().sort({createdAt:-1})); });
app.post('/stock/save', requireLogin, async(req,res)=>{ const {_id,...data}=req.body; if(_id) await Stock.findByIdAndUpdate(_id,data); else{ data.code=await generateUniqueCode(); await new Stock(data).save(); } res.json({success:true}); });
app.post('/stock/delete', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.body.id); res.json({success:true}); });

/* ================== API CLIENT ================== */
app.get('/api/clients', requireLogin, async(req,res)=>{ res.json(await Client.find().sort({createdAt:-1})); });
app.post('/client/save', requireLogin, async(req,res)=>{ const {_id,...data}=req.body; if(_id) await Client.findByIdAndUpdate(_id,data); else await new Client(data).save(); res.json({success:true}); });
app.post('/client/delete', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.body.id); res.json({success:true}); });

/* ================== API RATE ================== */
app.get('/api/rates', requireLogin, async(req,res)=>{ res.json(await Rate.find().sort({createdAt:-1})); });
app.post('/rate/save', requireLogin, async(req,res)=>{ const {_id,...data}=req.body; if(_id) await Rate.findByIdAndUpdate(_id,data); else await new Rate(data).save(); res.json({success:true}); });
app.post('/rate/delete', requireLogin, async(req,res)=>{ await Rate.findByIdAndDelete(req.body.id); res.json({success:true}); });

/* ================== SERVER ================== */
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('🚀 Server running on http://localhost:'+PORT));
