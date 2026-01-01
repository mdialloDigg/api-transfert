/******************************************************************
 * APP TRANSFERT + STOCK – VERSION FINALE COMPLÈTE (UN SEUL FICHIER)
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
app.use(session({
  secret:'transfert-stock-secret-final',
  resave:false,
  saveUninitialized:true
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert_stock')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= SCHEMAS ================= */

const stockSchema = new mongoose.Schema({
  reference:{type:String,unique:true},
  name:String,
  quantity:Number,
  price:Number,
  createdAt:{type:Date,default:Date.now}
});
const Stock = mongoose.model('Stock',stockSchema);

const transfertSchema = new mongoose.Schema({
  userType:String,

  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  originLocation:String,

  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  destinationLocation:String,

  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,

  products:[{
    productId:{type:mongoose.Schema.Types.ObjectId,ref:'Stock'},
    name:String,
    quantity:Number
  }],

  recoveryMode:String,
  retired:{type:Boolean,default:false},
  retraitHistory:[{date:Date,mode:String}],

  code:{type:String,unique:true},
  createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String,default:'agent'}
});
const Auth = mongoose.model('Auth',authSchema);

/* ================= UTILS ================= */

async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists = await Transfert.findOne({code});
  }
  return code;
}

const requireLogin=(req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

const locations=['France','Belgique','Conakry','Suisse','USA'];
const currencies=['GNF','EUR','USD','XOF'];
const retraitModes=['Espèces','Virement','Orange Money','Wave'];

/* ================= LOGIN ================= */

app.get('/login',(req,res)=>{
res.send(`
<html><head><style>
body{margin:0;height:100vh;display:flex;justify-content:center;align-items:center;
background:linear-gradient(135deg,#ff8c42,#ffa64d);font-family:Arial}
.box{background:white;padding:40px;border-radius:20px;width:360px;text-align:center}
input,button{width:100%;padding:15px;margin:10px 0;border-radius:10px;border:1px solid #ccc}
button{background:#ff8c42;color:white;font-weight:bold;border:none}
</style></head>
<body>
<div class="box">
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required>
<input type="password" name="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
</div>
</body></html>
`);
});

app.post('/login',async(req,res)=>{
  let user = await Auth.findOne({username:req.body.username});
  if(!user){
    user = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,user.password)){
    return res.send('Mot de passe incorrect');
  }
  req.session.user=user;
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= STOCK ================= */

app.get('/stock/list', requireLogin, async(req,res)=>{
  const search=(req.query.search||'').toLowerCase();
  let stocks = await Stock.find().sort({createdAt:-1});
  stocks = stocks.filter(s =>
    s.name.toLowerCase().includes(search) ||
    s.reference.toLowerCase().includes(search)
  );

  let html=`<html><body style="font-family:Arial;background:#f4f6f9;padding:20px">
  <h2>📦 Stock</h2>
  <form>
    <input name="search" placeholder="Recherche..." value="${req.query.search||''}">
    <button>🔍</button>
    <a href="/stock/form">➕ Nouveau</a>
    <a href="/transferts/list">💰 Transferts</a>
    <a href="/logout">🚪 Déconnexion</a>
  </form>
  <table border="1" cellspacing="0" cellpadding="5" width="100%">
  <tr><th>Réf</th><th>Nom</th><th>Qté</th><th>Prix</th><th>Actions</th></tr>`;

  stocks.forEach(s=>{
    html+=`<tr data-id="${s._id}">
      <td>${s.reference}</td>
      <td>${s.name}</td>
      <td>${s.quantity}</td>
      <td>${s.price}</td>
      <td>
        <a href="/stock/form?id=${s._id}">✏️</a>
        <button class="del">❌</button>
      </td>
    </tr>`;
  });

  html+=`</table>
  <script>
  document.querySelectorAll('.del').forEach(b=>{
    b.onclick=async()=>{
      if(confirm('Supprimer ?')){
        const id=b.closest('tr').dataset.id;
        await fetch('/stock/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
        b.closest('tr').remove();
      }
    }
  });
  </script>
  </body></html>`;
  res.send(html);
});

app.get('/stock/form', requireLogin, async(req,res)=>{
  const s=req.query.id?await Stock.findById(req.query.id):{};
  res.send(`<html><body style="font-family:Arial;padding:20px">
  <h2>${s._id?'✏️ Modifier':'➕ Nouveau'} produit</h2>
  <form method="post">
    <input type="hidden" name="id" value="${s._id||''}">
    <input name="reference" value="${s.reference||''}" placeholder="Référence" required><br>
    <input name="name" value="${s.name||''}" placeholder="Nom" required><br>
    <input type="number" name="quantity" value="${s.quantity||0}" placeholder="Quantité" required><br>
    <input type="number" name="price" value="${s.price||0}" placeholder="Prix" required><br>
    <button>💾 Enregistrer</button>
  </form>
  <a href="/stock/list">⬅ Retour</a>
  </body></html>`);
});

app.post('/stock/form', requireLogin, async(req,res)=>{
  if(req.body.id){
    await Stock.findByIdAndUpdate(req.body.id,req.body);
  } else {
    await new Stock(req.body).save();
  }
  res.redirect('/stock/list');
});

app.post('/stock/delete', requireLogin, async(req,res)=>{
  await Stock.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

/* ================= TRANSFERTS ================= */

app.get('/transferts/list', requireLogin, async(req,res)=>{
  const search=(req.query.search||'').toLowerCase();
  let trs=await Transfert.find().sort({createdAt:-1});
  trs=trs.filter(t =>
    t.code.toLowerCase().includes(search) ||
    t.senderFirstName.toLowerCase().includes(search) ||
    t.receiverFirstName.toLowerCase().includes(search)
  );

  let html=`<html><body style="font-family:Arial;background:#f4f6f9;padding:20px">
  <h2>💰 Transferts</h2>
  <form>
    <input name="search" placeholder="Recherche..." value="${req.query.search||''}">
    <button>🔍</button>
    <a href="/transferts/form">➕ Nouveau</a>
    <a href="/stock/list">📦 Stock</a>
    <a href="/logout">🚪 Déconnexion</a>
  </form>
  <table border="1" width="100%">
  <tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Statut</th><th>Actions</th></tr>`;

  trs.forEach(t=>{
    html+=`<tr data-id="${t._id}">
      <td>${t.code}</td>
      <td>${t.senderFirstName}</td>
      <td>${t.receiverFirstName}</td>
      <td>${t.amount} ${t.currency}</td>
      <td>${t.retired?'Retiré':'Non retiré'}</td>
      <td>
        <a href="/transferts/form?code=${t.code}">✏️</a>
        ${!t.retired?'<button class="ret">💰</button>':''}
        <button class="del">❌</button>
      </td>
    </tr>`;
  });

  html+=`</table>
  <script>
  document.querySelectorAll('.del').forEach(b=>{
    b.onclick=async()=>{
      if(confirm('Supprimer ?')){
        const id=b.closest('tr').dataset.id;
        await fetch('/transferts/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
        b.closest('tr').remove();
      }
    }
  });
  document.querySelectorAll('.ret').forEach(b=>{
    b.onclick=async()=>{
      const id=b.closest('tr').dataset.id;
      await fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:'Espèces'})});
      location.reload();
    }
  });
  </script>
  </body></html>`;
  res.send(html);
});

app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t=req.query.code?await Transfert.findOne({code:req.query.code}):{};
  const stocks=await Stock.find();
  const code=t.code||await generateUniqueCode();

  res.send(`<html><body style="font-family:Arial;padding:20px">
  <h2>${t._id?'✏️ Modifier':'➕ Nouveau'} transfert</h2>
  <form method="post">
    <input type="hidden" name="code" value="${code}">
    <input name="senderFirstName" value="${t.senderFirstName||''}" placeholder="Expéditeur" required><br>
    <input name="receiverFirstName" value="${t.receiverFirstName||''}" placeholder="Destinataire" required><br>
    <input type="number" name="amount" value="${t.amount||0}" placeholder="Montant" required><br>
    <input type="number" name="fees" value="${t.fees||0}" placeholder="Frais" required><br>
    <select name="currency">${currencies.map(c=>`<option>${c}</option>`).join('')}</select>

    <h4>Produits</h4>
    ${stocks.map(s=>`
      ${s.name} (stock:${s.quantity})
      <input type="number" name="product_${s._id}" value="0"><br>
    `).join('')}

    <button>💾 Enregistrer</button>
  </form>
  <a href="/transferts/list">⬅ Retour</a>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount=+req.body.amount, fees=+req.body.fees;
  const products=[];

  for(const k in req.body){
    if(k.startsWith('product_') && +req.body[k]>0){
      const p=await Stock.findById(k.replace('product_',''));
      p.quantity -= +req.body[k];
      await p.save();
      products.push({productId:p._id,name:p.name,quantity:+req.body[k]});
    }
  }

  await Transfert.findOneAndUpdate(
    {code:req.body.code},
    {...req.body,amount,fees,recoveryAmount:amount-fees,products},
    {upsert:true}
  );
  res.redirect('/transferts/list');
});

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,
    $push:{retraitHistory:{date:new Date(),mode:req.body.mode}}
  });
  res.send({ok:true});
});

app.post('/transferts/delete', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.send({ok:true});
});

/* ================= SERVER ================= */
app.listen(3000,()=>console.log('🚀 http://localhost:3000'));
