/******************************************************************
 * APP TOUT-EN-UN : TRANSFERTS + STOCK + AJAX + EXPORTS
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret:'transfert-stock-secret', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert_stock')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String, enum:['admin','agent'], default:'agent'}
});
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  name: { type: String, required: true },
  reference: { type: String, unique: true },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default: Date.now },
  products:[{
    productId: { type: mongoose.Schema.Types.ObjectId, ref:'Stock' },
    name: String,
    quantity: Number
  }]
});
const Transfert = mongoose.model('Transfert', transfertSchema);

// ================= UTIL =================
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

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><body>
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required>
      <input type="password" name="password" placeholder="Mot de passe" required>
      <button>Se connecter</button>
    </form>
  </body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/dashboard');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, (req,res)=>{
  res.send(`<html><body>
    <h2>🏠 Dashboard</h2>
    <a href="/transferts/list">📋 Liste des transferts</a><br>
    <a href="/transferts/form">➕ Nouveau transfert</a><br>
    <a href="/stock/list">📦 Liste des produits/stock</a><br>
    <a href="/stock/form">➕ Ajouter produit</a><br>
    <a href="/logout">🚪 Déconnexion</a>
  </body></html>`);
});

// ================= STOCK CRUD =================
app.get('/stock/form', requireLogin, async(req,res)=>{
  let s=null; if(req.query.id) s = await Stock.findById(req.query.id).lean();
  res.send(`<html><body>
    <h2>${s?'✏️ Modifier':'➕ Nouveau'} Produit</h2>
    <form method="post">
      <input type="hidden" name="id" value="${s?s._id:''}">
      <label>Nom:</label><input name="name" value="${s?s.name:''}" required><br>
      <label>Référence:</label><input name="reference" value="${s?s.reference:''}" required><br>
      <label>Quantité:</label><input type="number" name="quantity" value="${s?s.quantity:0}" min="0" required><br>
      <label>Prix:</label><input type="number" name="price" value="${s?s.price:0}" min="0" required><br>
      <label>Devise:</label>
      <select name="currency">${currencies.map(c=>`<option ${s&&s.currency===c?'selected':''}>${c}</option>`).join('')}</select><br><br>
      <button>${s?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/stock/list">⬅ Retour liste</a>
  </body></html>`);
});

app.post('/stock/form', requireLogin, async(req,res)=>{
  const {id,name,reference,quantity,price,currency} = req.body;
  if(id) await Stock.findByIdAndUpdate(id,{name,reference,quantity,price,currency});
  else await new Stock({name,reference,quantity,price,currency}).save();
  res.redirect('/stock/list');
});

app.get('/stock/list', requireLogin, async(req,res)=>{
  const { search='', minQty, maxQty } = req.query;
  let query = {};
  if(search) query.name = { $regex: search, $options: 'i' };
  if(minQty) query.quantity = { ...query.quantity, $gte: Number(minQty) };
  if(maxQty) query.quantity = { ...query.quantity, $lte: Number(maxQty) };
  const stock = await Stock.find(query).lean();

  let html='<html><body><h2>📦 Liste des produits/stock</h2>';
  html+=`<form method="get">
    <input name="search" placeholder="Nom produit..." value="${search}">
    <input name="minQty" type="number" placeholder="Qté min" value="${minQty||''}">
    <input name="maxQty" type="number" placeholder="Qté max" value="${maxQty||''}">
    <button>🔍 Filtrer</button>
  </form>`;
  html+='<table border="1" cellspacing="0" cellpadding="5"><tr><th>Nom</th><th>Réf</th><th>Qté</th><th>Prix</th><th>Devise</th><th>Actions</th></tr>';
  stock.forEach(s=>{
    html+=`<tr>
      <td>${s.name}</td>
      <td>${s.reference}</td>
      <td>${s.quantity}</td>
      <td>${s.price}</td>
      <td>${s.currency}</td>
      <td>
        <a href="/stock/form?id=${s._id}">✏️ Modifier</a>
        <a href="#" onclick="fetch('/stock/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${s._id}'})}).then(()=>location.reload())">❌ Supprimer</a>
      </td>
    </tr>`;
  });
  html+='</table><a href="/dashboard">⬅ Retour dashboard</a></body></html>';
  res.send(html);
});

app.post('/stock/delete', requireLogin, async(req,res)=>{
  if(req.body.id) await Stock.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= TRANSFERT CRUD =================
// Formulaire, ajout, modification, retrait, produits liés
app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code}).populate('products.productId').lean();
  const code = t?t.code:await generateUniqueCode();
  const allStock = await Stock.find().lean();

  res.send(`<html><body>
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <input name="code" readonly value="${code}">
      <label>Type de personne:</label>
      <select name="userType">
        <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
        <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
        <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
        <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
      </select><br>
      <label>Expéditeur:</label><input name="senderFirstName" placeholder="Prénom" value="${t?t.senderFirstName:''}" required>
      <input name="senderLastName" placeholder="Nom" value="${t?t.senderLastName:''}" required>
      <input name="senderPhone" placeholder="Téléphone" value="${t?t.senderPhone:''}" required><br>
      <label>Origine:</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select><br>
      <label>Destinataire:</label><input name="receiverFirstName" placeholder="Prénom" value="${t?t.receiverFirstName:''}" required>
      <input name="receiverLastName" placeholder="Nom" value="${t?t.receiverLastName:''}" required>
      <input name="receiverPhone" placeholder="Téléphone" value="${t?t.receiverPhone:''}" required><br>
      <label>Destination:</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select><br>
      <label>Montant:</label><input type="number" name="amount" value="${t?t.amount:0}" required>
      <label>Frais:</label><input type="number" name="fees" value="${t?t.fees:0}" required>
      <label>Montant à recevoir:</label><input type="number" name="recoveryAmount" readonly value="${t?t.recoveryAmount:0}"><br>
      <label>Devise:</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select><br>
      <label>Mode de retrait:</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select><br>
      <label>Produits:</label><br>
      ${allStock.map(s=>`<input type="number" name="product_${s._id}" placeholder="Qté ${s.name}" value="${t&&t.products.find(p=>String(p.productId._id)===String(s._id))?t.products.find(p=>String(p.productId._id)===String(s._id)).quantity:0}"> ${s.name}<br>`).join('')}
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/transferts/list">⬅ Retour liste</a>
    <script>
      const amountField=document.querySelector('[name="amount"]');
      const feesField=document.querySelector('[name="fees"]');
      const recoveryField=document.querySelector('[name="recoveryAmount"]');
      function updateRecovery(){recoveryField.value=(parseFloat(amountField.value)||0)-(parseFloat(feesField.value)||0);}
      amountField.addEventListener('input',updateRecovery);
      feesField.addEventListener('input',updateRecovery);
      updateRecovery();
    </script>
  </body></html>`);
});

// POST Transfert avec produits
app.post('/transferts/form', requireLogin, async(req,res)=>{
  const code = req.body.code || await generateUniqueCode();
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const products = Object.keys(req.body).filter(k=>k.startsWith('product_')).map(k=>{
    const qty = Number(req.body[k]);
    if(qty>0) return { productId: k.replace('product_',''), quantity: qty };
    return null;
  }).filter(Boolean);

  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount, products});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, products, retraitHistory:[], code}).save();
  res.redirect('/transferts/list');
});

// ================= TRANSFERT LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all' } = req.query;
  let transferts = await Transfert.find().populate('products.productId').sort({createdAt:-1}).lean();
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);

  let html='<html><body><h2>📋 Liste des transferts</h2>';
  html+=`<form method="get"><input name="search" value="${search}" placeholder="Recherche...">
         <select name="status"><option value="all" ${status==='all'?'selected':''}>Tous</option>
         <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
         <option value="non" ${status==='non'?'selected':''}>Non retirés</option></select>
         <button>🔍 Filtrer</button></form>`;
  html+='<table border="1" cellspacing="0" cellpadding="5"><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Produits</th><th>Status</th><th>Actions</th></tr>';
  transferts.forEach(t=>{
    html+=`<tr>
      <td>${t.code}</td>
      <td>${t.senderFirstName} ${t.senderLastName}</td>
      <td>${t.receiverFirstName} ${t.receiverLastName}</td>
      <td>${t.amount}</td>
      <td>${t.fees}</td>
      <td>${t.recoveryAmount}</td>
      <td>${t.currency}</td>
      <td>${t.products.map(p=>p.productId?`${p.productId.name}(${p.quantity})`:``).join(', ')}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <a href="/transferts/form?code=${t.code}">✏️ Modifier</a>
        <a href="#" onclick="fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${t._id}'})}).then(()=>location.reload())">❌ Supprimer</a>
      </td>
    </tr>`;
  });
  html+='</table><a href="/dashboard">⬅ Retour dashboard</a></body></html>';
  res.send(html);
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  if(req.body.id) await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
