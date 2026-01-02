/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN (Render + MongoDB Atlas)
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/stockDB';

// ===== Middleware =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== MongoDB =====
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// ===== SCHEMAS =====
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  destination: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default: 'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

// ===== Utils =====
async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
global.requireLogin = requireLogin;

function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ===== LOGIN =====
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
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
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ===== Toutes les routes transferts + AJAX + exports PDF/Excel/Word =====
// ... [ici tu peux coller toutes tes routes existantes du code précédent]

// ===== ROUTES STOCKS =====
// Page stocks responsive avec AJAX
app.get('/transferts/stock', async (req,res)=>{
  const stocks = await Stock.find();
  let stockRows = stocks.map(s => `
    <tr data-id="${s._id}">
      <td><input value="${s.sender}"></td>
      <td><input value="${s.destination}"></td>
      <td><input value="${s.amount}"></td>
      <td><input value="${s.currency}"></td>
      <td>
        <button class="modifyBtn">Modifier</button>
        <button class="deleteBtn">Supprimer</button>
      </td>
    </tr>
  `).join('');

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stocks</title>
<style>
table, input { border: 1px solid #ccc; padding: 5px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding:5px; }
@media(max-width:600px){ table, tr, td { display:block; width:100%; } td input{width:95%;} }
</style></head><body>
<h2>Stocks</h2>
<table id="stockTable"><thead><tr><th>Sender</th><th>Destination</th><th>Amount</th><th>Currency</th><th>Actions</th></tr></thead><tbody>${stockRows}</tbody></table>
<h3>Ajouter un stock</h3><div id="newStocks"></div>
<button id="addRowBtn">+ Ligne</button>
<button id="submitStocksBtn">Ajouter Stocks</button>
<script>
const newStocksDiv = document.getElementById('newStocks');
const addRowBtn = document.getElementById('addRowBtn');
const submitStocksBtn = document.getElementById('submitStocksBtn');
const stockTable = document.getElementById('stockTable').querySelector('tbody');
addRowBtn.onclick = ()=>{
  const div = document.createElement('div'); div.style.marginBottom='5px';
  div.innerHTML=`<input name="sender" placeholder="Sender"><input name="destination" placeholder="Destination"><input name="amount" placeholder="Amount"><input name="currency" placeholder="Currency"><button type="button">Supprimer</button>`;
  div.querySelector('button').onclick=()=>div.remove();
  newStocksDiv.appendChild(div);
};
submitStocksBtn.onclick=async()=>{
const divs=[...newStocksDiv.children]; if(divs.length===0)return alert('Aucune ligne à ajouter');
const stocksData=divs.map(d=>({sender:d.querySelector('input[name="sender"]').value,destination:d.querySelector('input[name="destination"]').value,amount:parseFloat(d.querySelector('input[name="amount"]').value),currency:d.querySelector('input[name="currency"]').value}));
const res=await fetch('/transferts/stock/multi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stocks:stocksData})});
const data=await res.json();alert(data.message);if(!data.ok)return;
data.addedStocks.forEach(s=>{const tr=document.createElement('tr');tr.dataset.id=s._id;tr.innerHTML=`<td><input value="${s.sender}"></td><td><input value="${s.destination}"></td><td><input value="${s.amount}"></td><td><input value="${s.currency}"></td><td><button class="modifyBtn">Modifier</button><button class="deleteBtn">Supprimer</button></td>`;stockTable.prepend(tr);attachRowEvents(tr);});
newStocksDiv.innerHTML='';};
function attachRowEvents(tr){const id=tr.dataset.id;tr.querySelector('.modifyBtn').onclick=async()=>{const body={sender:tr.children[0].querySelector('input').value,destination:tr.children[1].querySelector('input').value,amount:parseFloat(tr.children[2].querySelector('input').value),currency:tr.children[3].querySelector('input').value};const res=await fetch('/transferts/stock/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();alert(data.message);};tr.querySelector('.deleteBtn').onclick=async()=>{const res=await fetch('/transferts/stock/'+id,{method:'DELETE'});const data=await res.json();alert(data.message);if(data.ok)tr.remove();};}
document.querySelectorAll('#stockTable tbody tr').forEach(tr=>attachRowEvents(tr));
</script></body></html>`);
});

// ===== API Stocks =====
app.post('/transferts/stock/multi', async (req,res)=>{ const { stocks: newStocks } = req.body; if(!newStocks || !Array.isArray(newStocks)) return res.json({ok:false,message:'Aucune donnée reçue'}); try{ const addedStocks = await Stock.insertMany(newStocks); res.json({ok:true,message:'Stocks ajoutés',addedStocks}); }catch(err){res.json({ok:false,message:err.message});}});
app.put('/transferts/stock/:id', async(req,res)=>{try{const updated = await Stock.findByIdAndUpdate(req.params.id, req.body, {new:true}); if(!updated) return res.json({ok:false,message:'Stock introuvable'}); res.json({ok:true,message:'Stock modifié'});}catch(err){res.json({ok:false,message:err.message});}});
app.delete('/transferts/stock/:id', async(req,res)=>{try{const deleted=await Stock.findByIdAndDelete(req.params.id); if(!deleted) return res.json({ok:false,message:'Stock introuvable'}); res.json({ok:true,message:'Stock supprimé'});}catch(err){res.json({ok:false,message:err.message});}});

// ===== Start server =====
app.listen(PORT,()=>console.log('Server running on port',PORT));
