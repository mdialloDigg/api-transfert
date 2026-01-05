/********************************************************************
 * APP COMPLET : Dashboard Transfert + Stock + Client + Devise
 * Backend + Frontend + AJAX + CSS + Login + Roles
 ********************************************************************/
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());

// ---------------- SESSION -----------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret123',
  resave: false,
  saveUninitialized: true
}));

// ---------------- DATABASE -----------------
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert';
mongoose.connect(mongoUri)
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(err=>{console.error('❌ MongoDB error', err); process.exit(1);});

// ---------------- SCHEMAS -----------------
const transfertSchema = new mongoose.Schema({
  sender:String, receiver:String, origin:String, destination:String,
  amount:Number, fees:Number, received:Number, currency:String,
  retired:{type:Boolean,default:false}, code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}, retraitHistory:[{date:Date, mode:String}]
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  sender:String, destination:String, amount:Number, currency:String,
  code:{type:String,unique:true}, createdAt:{type:Date,default:Date.now}
});
const Stock = mongoose.model('Stock', stockSchema);

const clientSchema = new mongoose.Schema({
  firstName:String,lastName:String,phone:String,email:String,
  kycVerified:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}
});
const Client = mongoose.model('Client', clientSchema);

const deviseSchema = new mongoose.Schema({
  from:String, to:String, rate:Number, createdAt:{type:Date,default:Date.now}
});
const Devise = mongoose.model('Devise', deviseSchema);

// ---------------- USERS -----------------
const users = [
  { email:'admin@example.com', password:bcrypt.hashSync('admin123',10), role:'admin' },
  { email:'user@example.com', password:bcrypt.hashSync('user123',10), role:'user' }
];

// ---------------- UTILS -----------------
function requireLogin(req,res,next){
  if(req.session.user) return next();
  res.redirect('/login');
}

function generateCode(){
  const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
  const number = Math.floor(100+Math.random()*900);
  return letter+number;
}

// ---------------- LOGIN -----------------
app.get('/login',(req,res)=>{
  res.send(`
    <html><head><meta charset="utf-8">
    <title>Login</title>
    <style>
      body{display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;}
      .login-box{background:#fff;padding:30px;border-radius:15px;box-shadow:0 10px 20px rgba(0,0,0,0.2);width:300px;text-align:center;}
      input{width:100%;padding:10px;margin:10px 0;border-radius:8px;border:1px solid #ccc;}
      button{width:100%;padding:10px;border:none;border-radius:8px;background:#ff8c42;color:#fff;font-weight:bold;cursor:pointer;}
      button:hover{background:#e67300;}
    </style>
    </head>
    <body>
      <div class="login-box">
        <h2>Login</h2>
        <form method="POST" action="/login">
          <input name="email" type="email" placeholder="Email" required>
          <input name="password" type="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
    </body></html>
  `);
});

app.post('/login',(req,res)=>{
  const { email, password } = req.body;
  const user = users.find(u=>u.email===email);
  if(user && bcrypt.compareSync(password,user.password)){
    req.session.user = { email:user.email, role:user.role };
    res.redirect('/');
  } else {
    res.send('Login failed <a href="/login">Try again</a>');
  }
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// ---------------- DASHBOARD -----------------
app.get('/', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const clients = await Client.find().sort({createdAt:-1});
  const devises = await Devise.find().sort({createdAt:-1});

  res.send(`
  <html>
  <head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dashboard</title>
    <style>
      body{font-family:sans-serif;background:#f0f2f5;padding:20px;}
      h2{color:#ff8c42;}
      table{border-collapse:collapse;width:100%;margin-bottom:20px;}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;}
      th{background:#ff8c42;color:#fff;}
      button{margin:2px;padding:5px 10px;cursor:pointer;border-radius:5px;border:none;background:#ff8c42;color:white;}
      button:hover{background:#e67300;}
      .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
      .modal-content{background:white;padding:20px;border-radius:10px;max-width:400px;width:90%;}
      input,select{width:100%;padding:5px;margin:5px 0;border-radius:5px;border:1px solid #ccc;}
    </style>
  </head>
  <body>
    <h2>Dashboard - Role: ${req.session.user.role}</h2>
    <a href="/logout">Logout</a>

    <h3>Transferts</h3>
    <button onclick="openTransfertModal()">Nouveau</button>
    <table id="transfertTable">
      <tr><th>Code</th><th>Sender</th><th>Receiver</th><th>Montant</th><th>Status</th><th>Actions</th></tr>
      ${transferts.map(t=>`
        <tr data-id="${t._id}">
          <td>${t.code}</td>
          <td>${t.sender}</td>
          <td>${t.receiver}</td>
          <td>${t.amount}</td>
          <td>${t.retired?'Retiré':'Non retiré'}</td>
          <td>
            ${req.session.user.role==='admin'?`<button onclick="editTransfert('${t._id}')">✏️</button>
            <button onclick="deleteTransfert('${t._id}')">❌</button>
            ${!t.retired?`<button onclick="retirerTransfert('${t._id}')">💰</button>`:''}`:''}
            <button onclick="printRow(this)">🖨</button>
          </td>
        </tr>
      `).join('')}
    </table>

    <h3>Stocks</h3>
    <button onclick="openStockModal()">Nouveau</button>
    <table id="stockTable">
      <tr><th>Code</th><th>Sender</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>
      ${stocks.map(s=>`
        <tr data-id="${s._id}">
          <td>${s.code}</td><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td>
          <td>
            ${req.session.user.role==='admin'?`<button onclick="editStock('${s._id}')">✏️</button><button onclick="deleteStock('${s._id}')">❌</button>`:''}
            <button onclick="printRow(this)">🖨</button>
          </td>
        </tr>
      `).join('')}
    </table>

    <h3>Clients</h3>
    <button onclick="openClientModal()">Nouveau</button>
    <table id="clientTable">
      <tr><th>Nom</th><th>Prénom</th><th>Phone</th><th>KYC</th><th>Actions</th></tr>
      ${clients.map(c=>`
        <tr data-id="${c._id}">
          <td>${c.lastName}</td><td>${c.firstName}</td><td>${c.phone}</td><td>${c.kycVerified?'✅':'❌'}</td>
          <td>
            ${req.session.user.role==='admin'?`<button onclick="editClient('${c._id}')">✏️</button><button onclick="deleteClient('${c._id}')">❌</button>`:''}
          </td>
        </tr>
      `).join('')}
    </table>

    <h3>Devises</h3>
    <button onclick="openDeviseModal()">Nouveau</button>
    <table id="deviseTable">
      <tr><th>De</th><th>Vers</th><th>Rate</th><th>Actions</th></tr>
      ${devises.map(d=>`
        <tr data-id="${d._id}">
          <td>${d.from}</td><td>${d.to}</td><td>${d.rate}</td>
          <td>
            ${req.session.user.role==='admin'?`<button onclick="editDevise('${d._id}')">✏️</button><button onclick="deleteDevise('${d._id}')">❌</button>`:''}
          </td>
        </tr>
      `).join('')}
    </table>

    <!-- MODALS -->
    <div id="transfertModal" class="modal">
      <div class="modal-content">
        <h4>Transfert</h4>
        <input id="t_sender" placeholder="Sender">
        <input id="t_receiver" placeholder="Receiver">
        <input id="t_amount" type="number" placeholder="Amount">
        <select id="t_currency"><option>USD</option><option>EUR</option></select>
        <button onclick="saveTransfert()">Save</button>
        <button onclick="closeModal('transfertModal')">Close</button>
      </div>
    </div>

    <div id="stockModal" class="modal">
      <div class="modal-content">
        <h4>Stock</h4>
        <input id="s_sender" placeholder="Sender">
        <input id="s_destination" placeholder="Destination">
        <input id="s_amount" type="number" placeholder="Amount">
        <select id="s_currency"><option>USD</option><option>EUR</option></select>
        <button onclick="saveStock()">Save</button>
        <button onclick="closeModal('stockModal')">Close</button>
      </div>
    </div>

    <div id="clientModal" class="modal">
      <div class="modal-content">
        <h4>Client</h4>
        <input id="c_firstName" placeholder="First Name">
        <input id="c_lastName" placeholder="Last Name">
        <input id="c_phone" placeholder="Phone">
        <select id="c_kyc"><option value="false">Non</option><option value="true">Oui</option></select>
        <button onclick="saveClient()">Save</button>
        <button onclick="closeModal('clientModal')">Close</button>
      </div>
    </div>

    <div id="deviseModal" class="modal">
      <div class="modal-content">
        <h4>Devise</h4>
        <input id="d_from" placeholder="From">
        <input id="d_to" placeholder="To">
        <input id="d_rate" type="number" step="0.0001" placeholder="Rate">
        <button onclick="saveDevise()">Save</button>
        <button onclick="closeModal('deviseModal')">Close</button>
      </div>
    </div>

    <!-- SCRIPTS -->
    <script>
      let editId = null;

      function openTransfertModal(id=null){
        editId = id;
        document.getElementById('transfertModal').style.display='flex';
        if(id){
          const tr=document.querySelector('#transfertTable tr[data-id="'+id+'"]');
          t_sender.value=tr.children[1].innerText;
          t_receiver.value=tr.children[2].innerText;
          t_amount.value=tr.children[3].innerText;
        } else { t_sender.value=''; t_receiver.value=''; t_amount.value=''; }
      }

      function openStockModal(id=null){ editId=id; document.getElementById('stockModal').style.display='flex'; }
      function openClientModal(id=null){ editId=id; document.getElementById('clientModal').style.display='flex'; }
      function openDeviseModal(id=null){ editId=id; document.getElementById('deviseModal').style.display='flex'; }
      function closeModal(mid){ document.getElementById(mid).style.display='none'; editId=null; }

      async function saveTransfert(){
        const data={ sender:t_sender.value, receiver:t_receiver.value, amount:parseFloat(t_amount.value), currency:t_currency.value };
        if(editId) data._id=editId;
        await fetch('/api/transferts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        location.reload();
      }

      async function deleteTransfert(id){ if(confirm('Supprimer?')) await fetch('/api/transferts/'+id,{method:'DELETE'}); location.reload(); }
      async function retirerTransfert(id){ if(confirm('Marquer comme retiré?')) await fetch('/api/transferts/retirer/'+id,{method:'POST'}); location.reload(); }

      async function saveStock(){ const data={sender:s_sender.value,destination:s_destination.value,amount:parseFloat(s_amount.value),currency:s_currency.value}; if(editId) data._id=editId; await fetch('/api/stocks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); location.reload();}
      async function deleteStock(id){ if(confirm('Supprimer?')) await fetch('/api/stocks/'+id,{method:'DELETE'}); location.reload(); }

      async function saveClient(){ const data={firstName:c_firstName.value,lastName:c_lastName.value,phone:c_phone.value,kycVerified:c_kyc.value==='true'}; if(editId) data._id=editId; await fetch('/api/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); location.reload();}
      async function deleteClient(id){ if(confirm('Supprimer?')) await fetch('/api/clients/'+id,{method:'DELETE'}); location.reload(); }

      async function saveDevise(){ const data={from:d_from.value,to:d_to.value,rate:parseFloat(d_rate.value)}; if(editId) data._id=editId; await fetch('/api/devises',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); location.reload();}
      async function deleteDevise(id){ if(confirm('Supprimer?')) await fetch('/api/devises/'+id,{method:'DELETE'}); location.reload(); }

      function printRow(btn){ const tr=btn.closest('tr'); const w=window.open('','_blank'); w.document.write('<table border="1">'+tr.outerHTML+'</table>'); w.print(); }
    </script>

  </body></html>
  `);
});

// ---------------- API -----------------
app.post('/api/transferts', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id){
    await Transfert.findByIdAndUpdate(data._id,data);
  } else {
    data.code = generateCode();
    data.retired=false;
    await new Transfert(data).save();
  }
  res.json({success:true});
});

app.delete('/api/transferts/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

app.post('/api/transferts/retirer/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  t.retired=true; t.retraitHistory.push({date:new Date(),mode:'ESPECE'});
  await t.save(); res.json({success:true});
});

// Stocks
app.post('/api/stocks', requireLogin, async(req,res)=>{
  const data=req.body;
  if(data._id) await Stock.findByIdAndUpdate(data._id,data);
  else data.code=generateCode(), await new Stock(data).save();
  res.json({success:true});
});
app.delete('/api/stocks/:id', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.params.id); res.json({success:true}); });

// Clients
app.post('/api/clients', requireLogin, async(req,res)=>{
  const data=req.body; if(data._id) await Client.findByIdAndUpdate(data._id,data); else await new Client(data).save(); res.json({success:true});
});
app.delete('/api/clients/:id', requireLogin, async(req,res)=>{ await Client.findByIdAndDelete(req.params.id); res.json({success:true}); });

// Devises
app.post('/api/devises', requireLogin, async(req,res)=>{
  const data=req.body; if(data._id) await Devise.findByIdAndUpdate(data._id,data); else await new Devise(data).save(); res.json({success:true});
});
app.delete('/api/devises/:id', requireLogin, async(req,res)=>{ await Devise.findByIdAndDelete(req.params.id); res.json({success:true}); });

// ---------------- SERVER -----------------
const port = process.env.PORT || 3000;
app.listen(port,()=>console.log('🚀 Server running on http://localhost:'+port));
