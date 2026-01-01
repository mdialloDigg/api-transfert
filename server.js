const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

mongoose.connect('mongodb://127.0.0.1:27017/transfert').then(()=>console.log('✅ MongoDB connecté'));

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
  deposant: String,
  telephone: String,
  devise: { type: String, enum:['GNF','EUR','USD','XOF'], default: 'GNF' },
  montant: Number,
  lieuDepot: String,
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

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
function setPermissions(username){ return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true }; }

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

app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||''; const status = req.query.status||'all';
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
  .container{max-width:900px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
  h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
  form{display:grid;gap:15px;}
  label{font-weight:bold;margin-bottom:5px;display:block;}
  input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
  input[readonly]{background:#e9ecef;}
  button{padding:15px;background:#ff8c42;color:white;font-weight:bold;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
  button:hover{background:#e67300;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;}
  .section-title{margin-top:20px;font-size:18px;color:#ff8c42;font-weight:bold;border-bottom:2px solid #ff8c42;padding-bottom:5px;}
  a{display:inline-block;margin-top:15px;color:#ff8c42;text-decoration:none;font-weight:bold;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <div class="container">
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <input type="hidden" name="_search" value="${search}">
      <input type="hidden" name="_status" value="${status}">
      <div class="section-title">Type de personne</div>
      <select name="userType">
        <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
        <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
        <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
        <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
      </select>
      <div class="section-title">Expéditeur</div>
      <div class="grid">
        <div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
        <div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
        <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
        <div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="section-title">Destinataire</div>
      <div class="grid">
        <div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
        <div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
        <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
        <div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="section-title">Montants & Devise</div>
      <div class="grid">
        <div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
        <div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
        <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
        <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
      </div>
      <div class="section-title">Mode de retrait</div>
      <select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/transferts/list?search=${encodeURIComponent(search)}&status=${status}">⬅ Retour liste</a>
    <script>
      const amountField=document.getElementById('amount');
      const feesField=document.getElementById('fees');
      const recoveryField=document.getElementById('recoveryAmount');
      function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
      amountField.addEventListener('input',updateRecovery);
      feesField.addEventListener('input',updateRecovery);
      updateRecovery();
    </script>
  </div></body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code}).save();
  res.redirect(`/transferts/list`);
});

app.get('/stocks/form', requireLogin, async (req,res)=>{
  let stock = null;
  if(req.query.stockId) stock = await Stock.findById(req.query.stockId);
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f0f4f8;margin:0;padding:10px;}
  .container{max-width:500px;margin:20px auto;padding:20px;background:#fff;border-radius:15px;box-shadow:0 8px 20px rgba(0,0,0,0.2);}
  h2{color:#ff8c42;text-align:center;margin-bottom:20px;}
  form{display:grid;gap:15px;}
  label{font-weight:bold;}
  input,select{padding:12px;border-radius:8px;border:1px solid #ccc;width:100%;font-size:16px;}
  button{padding:15px;background:#ff8c42;color:white;font-weight:bold;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:0.3s;}
  button:hover{background:#e67300;}
  a{display:block;margin-top:15px;color:#ff8c42;text-decoration:none;text-align:center;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <div class="container">
    <h2>${stock?'✏️ Modifier Stock':'➕ Nouveau Stock'}</h2>
    <form method="post">
      ${stock?`<input type="hidden" name="stockId" value="${stock._id}">`:''}
      <label>Nom du déposant</label><input name="deposant" required value="${stock?stock.deposant:''}">
      <label>Téléphone</label><input name="telephone" required value="${stock?stock.telephone:''}">
      <label>Montant</label><input type="number" name="montant" required value="${stock?stock.montant:''}">
      <label>Devise</label>
      <select name="devise">${currencies.map(c=>`<option ${stock&&stock.devise===c?'selected':''}>${c}</option>`).join('')}</select>
      <label>Lieu de dépôt</label><input name="lieuDepot" required value="${stock?stock.lieuDepot:''}">
      <button>Valider</button>
    </form>
    <a href="/stocks/list">⬅ Retour</a>
  </div></body></html>`);
});

app.post('/stocks/form', requireLogin, async(req,res)=>{
  const { stockId, deposant, telephone, montant, devise, lieuDepot } = req.body;
  if(stockId) await Stock.findByIdAndUpdate(stockId,{deposant,telephone,montant:Number(montant),devise,lieuDepot});
  else await new Stock({deposant,telephone,montant:Number(montant),devise,lieuDepot}).save();
  res.redirect('/stocks/list');
});

app.get('/stocks/list', requireLogin, async (req,res)=>{
  const { search='', page=1 } = req.query;
  let stocks = await Stock.find().sort({ createdAt: -1 });
  const s = search.toLowerCase();
  stocks = stocks.filter(st => st.deposant.toLowerCase().includes(s) || st.lieuDepot.toLowerCase().includes(s) || st.telephone.includes(s));
  const limit=20, totalPages=Math.ceil(stocks.length/limit), paginated=stocks.slice((page-1)*limit,page*limit);
  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <h2>📋 Liste des Stocks</h2>
  <form id="filterForm">
    <input type="text" name="search" placeholder="Recherche..." value="${search}">
    <button type="submit">🔍 Filtrer</button>
    <a href="/stocks/form">➕ Nouveau Stock</a>
    <a href="/transferts/list">⬅ Retour Transferts</a>
  </form>
  <table>
    <thead><tr><th>Nom</th><th>Téléphone</th><th>Montant</th><th>Devise</th><th>Lieu</th><th>Date</th><th>Actions</th></tr></thead><tbody>`;
  paginated.forEach(st=>{
    html += `<tr data-id="${st._id}">
      <td>${st.deposant}</td><td>${st.telephone}</td><td>${st.montant}</td><td>${st.devise}</td><td>${st.lieuDepot}</td><td>${st.createdAt.toLocaleString()}</td>
      <td><a href="/stocks/form?stockId=${st._id}"><button class="modify">✏️</button></a><button class="delete">❌</button></td>
    </tr>`;
  });
  html += `</tbody></table><div>`;
  for(let p=1;p<=totalPages;p++) html += `<a href="?page=${p}&search=${encodeURIComponent(search)}">${p}</a> `;
  html += `</div>
  <script>
    document.getElementById('filterForm').onsubmit=function(e){ e.preventDefault(); window.location='?search='+encodeURIComponent(this.search.value); };
    async function postData(url,data){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
    document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{ if(confirm('❌ Supprimer?')){ const tr=btn.closest('tr'); await postData('/stocks/delete',{id:tr.dataset.id}); tr.remove(); } });
  </script></body></html>`;
  res.send(html);
});

app.post('/stocks/delete', requireLogin, async(req,res)=>{ await Stock.findByIdAndDelete(req.body.id); res.send({ok:true}); });

app.listen(3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
