/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN AVEC STOCK ET PRODUITS
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
app.use(session({ secret:'transfert-secret-final', resave:false, saveUninitialized:true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now },

  // Produits liés au transfert
  products:[{
    productId: { type: mongoose.Schema.Types.ObjectId, ref:'Stock' },
    name: String,
    quantity: Number
  }]
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  name: { type: String, required: true },
  reference: { type: String, unique: true },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  currency: { type: String, enum: ['GNF','EUR','USD','XOF'], default:'GNF' },
  createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
const Auth = mongoose.model('Auth', authSchema);

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

// ================= AUTH =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
    .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
    .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
    .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
    .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
    .login-container button:hover{background:#e67300;}
  </style>
  </head><body>
    <div class="login-container">
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
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){ const hashed = bcrypt.hashSync(password,10); user = await new Auth({ username, password:hashed }).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE TRANSFERT =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');
  let t=null; if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t?t.code:await generateUniqueCode();
  const search = req.query.search||''; const status = req.query.status||'all';

  // Récupérer les produits disponibles pour le formulaire
  const allStock = await Stock.find().lean();

  res.send(`<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
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
  </style>
  </head><body>
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

      <!-- PRODUITS -->
      <div class="section-title">Produits</div>
      <div id="productsContainer"></div>
      <button type="button" id="addProduct">➕ Ajouter produit</button>

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

      // Gestion produits
      const productsContainer = document.getElementById('productsContainer');
      const productsList = ${t && t.products ? JSON.stringify(t.products) : '[]'};
      const stockOptions = ${JSON.stringify(allStock)};
      function renderProducts(){
        productsContainer.innerHTML = '';
        productsList.forEach((p,i)=>{
          const div = document.createElement('div');
          div.style.marginBottom='10px';
          div.innerHTML = \`
            <select name="products[\${i}][productId]" required>
              <option value="">Sélectionner produit</option>
              \${stockOptions.map(s=>\`<option value="\${s._id}" \${s._id===p.productId?'selected':''}>\${s.name} (Stock: \${s.quantity})</option>\`).join('')}
            </select>
            <input type="number" name="products[\${i}][quantity]" min="1" value="\${p.quantity||1}" required>
            <button type="button" onclick="productsList.splice(\${i},1);renderProducts()">❌</button>
          \`;
          productsContainer.appendChild(div);
        });
      }
      document.getElementById('addProduct').onclick = ()=>{
        productsList.push({ productId:'', quantity:1 });
        renderProducts();
      };
      renderProducts();
    </script>
  </div></body></html>`);
});

// ================= POST FORMULAIRE =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send('Accès refusé');

  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();

  // Gérer les produits
  let products = [];
  if(req.body.products){
    products = Array.isArray(req.body.products) ? req.body.products : Object.values(req.body.products);
    products = products.map(p=>({ productId:p.productId, quantity:Number(p.quantity) }));
    for(let p of products){
      const stockItem = await Stock.findById(p.productId);
      if(!stockItem) return res.send(`Produit introuvable: ${p.productId}`);
      p.name = stockItem.name;
    }
  }

  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount, products});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory:[], code, products}).save();

  res.redirect(`/transferts/list?search=${encodeURIComponent(req.body._search||'')}&status=${req.body._status||'all'}`);
});

// ================= LISTE TRANSFERTS =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all', page=1 } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1}).lean();
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  const limit=20;
  const totalPages = Math.ceil(transferts.length/limit);
  const paginated = transferts.slice((page-1)*limit,page*limit);

  // Totaux financiers
  const totals = {};
  paginated.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // Totaux produits par destination
  const productTotals = {};
  paginated.forEach(t=>{
    if(!productTotals[t.destinationLocation]) productTotals[t.destinationLocation]={};
    if(t.products){
      t.products.forEach(p=>{
        if(!productTotals[t.destinationLocation][p.name]) productTotals[t.destinationLocation][p.name]=0;
        productTotals[t.destinationLocation][p.name]+=p.quantity;
      });
    }
  });

  // Générer HTML liste (simplifié pour lecture)
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  .imprimer{background:#17a2b8;}
  a{margin-right:10px;text-decoration:none;color:#007bff;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <h3>📊 Totaux financiers par destination/devise</h3>
  <table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
  for(let dest in totals){
    for(let curr in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html+='</tbody></table>';

  // Totaux produits
  html+='<h3>📦 Totaux produits par destination</h3><table><thead><tr><th>Destination</th><th>Produit</th><th>Quantité</th></tr></thead><tbody>';
  for(let dest in productTotals){
    for(let prod in productTotals[dest]){
      html+=`<tr><td>${dest}</td><td>${prod}</td><td>${productTotals[dest][prod]}</td></tr>`;
    }
  }
  html+='</tbody></table>';

  html+='<a href="/transferts/form">➕ Nouveau transfert</a>';
  html+='<a href="/transferts/pdf">📄 PDF</a><a href="/transferts/excel">📊 Excel</a><a href="/transferts/word">📝 Word</a>';
  html+='</body></html>';
  res.send(html);
});

// ================= EXPORT PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1}).lean();
  const doc = new PDFDocument({ margin:30, size:'A4' });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);

  doc.fontSize(18).text('Liste des transferts', {align:'center'}).moveDown();
  transferts.forEach(t=>{
    doc.fontSize(12).text(`Code:${t.code} | Exp:${t.senderFirstName} ${t.senderLastName} | Dest:${t.receiverFirstName} ${t.receiverLastName} | Montant:${t.amount} ${t.currency} | Frais:${t.fees} | Reçu:${t.recoveryAmount} | Statut:${t.retired?'Retiré':'Non retiré'}`);
    if(t.products && t.products.length>0){
      t.products.forEach(p=>{
        doc.fontSize(10).text(`   ➤ ${p.name}: ${p.quantity}`, {indent:15});
      });
    }
    doc.moveDown(0.5);
  });

  // Totaux produits
  const productTotals = {};
  transferts.forEach(t=>{
    if(!productTotals[t.destinationLocation]) productTotals[t.destinationLocation]={};
    if(t.products){
      t.products.forEach(p=>{
        if(!productTotals[t.destinationLocation][p.name]) productTotals[t.destinationLocation][p.name]=0;
        productTotals[t.destinationLocation][p.name]+=p.quantity;
      });
    }
  });

  doc.addPage();
  doc.fontSize(16).text('📦 Totaux produits par destination', {align:'center'}).moveDown();
  for(let dest in productTotals){
    doc.fontSize(12).text(`Destination: ${dest}`);
    for(let prod in productTotals[dest]){
      doc.fontSize(10).text(`   ➤ ${prod}: ${productTotals[dest][prod]}`, {indent:15});
    }
    doc.moveDown(0.5);
  }

  doc.end();
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1}).lean();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');

  sheet.columns=[
    {header:'Code',key:'code',width:15},
    {header:'Expéditeur',key:'sender',width:30},
    {header:'Destinataire',key:'receiver',width:30},
    {header:'Destination',key:'destinationLocation',width:15},
    {header:'Montant',key:'amount',width:12},
    {header:'Frais',key:'fees',width:12},
    {header:'Reçu',key:'recoveryAmount',width:12},
    {header:'Devise',key:'currency',width:10},
    {header:'Statut',key:'status',width:12},
    {header:'Date',key:'createdAt',width:20},
    {header:'Produit',key:'product',width:25},
    {header:'Qté produit',key:'productQty',width:12}
  ];

  transferts.forEach(t=>{
    if(t.products && t.products.length>0){
      t.products.forEach(p=>{
        sheet.addRow({
          code:t.code,
          sender:`${t.senderFirstName} ${t.senderLastName}`,
          receiver:`${t.receiverFirstName} ${t.receiverLastName}`,
          destinationLocation:t.destinationLocation,
          amount:t.amount,
          fees:t.fees,
          recoveryAmount:t.recoveryAmount,
          currency:t.currency,
          status:t.retired?'Retiré':'Non retiré',
          createdAt:t.createdAt.toLocaleString(),
          product:p.name,
          productQty:p.quantity
        });
      });
    } else {
      sheet.addRow({
        code:t.code,
        sender:`${t.senderFirstName} ${t.senderLastName}`,
        receiver:`${t.receiverFirstName} ${t.receiverLastName}`,
        destinationLocation:t.destinationLocation,
        amount:t.amount,
        fees:t.fees,
        recoveryAmount:t.recoveryAmount,
        currency:t.currency,
        status:t.retired?'Retiré':'Non retiré',
        createdAt:t.createdAt.toLocaleString(),
        product:'',
        productQty:''
      });
    }
  });

  // Totaux produits
  const productTotals = {};
  transferts.forEach(t=>{
    if(!productTotals[t.destinationLocation]) productTotals[t.destinationLocation]={};
    if(t.products){
      t.products.forEach(p=>{
        if(!productTotals[t.destinationLocation][p.name]) productTotals[t.destinationLocation][p.name]=0;
        productTotals[t.destinationLocation][p.name]+=p.quantity;
      });
    }
  });

  const totalSheet = workbook.addWorksheet('Totaux produits');
  totalSheet.columns = [
    {header:'Destination', key:'destination', width:20},
    {header:'Produit', key:'product', width:25},
    {header:'Quantité', key:'qty', width:12}
  ];
  for(let dest in productTotals){
    for(let prod in productTotals[dest]){
      totalSheet.addRow({destination:dest, product:prod, qty:productTotals[dest][prod]});
    }
  }

  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1}).lean();
  let html='<html><head><meta charset="UTF-8"><title>Transferts</title></head><body>';
  html+='<h2>Liste des transferts</h2><table border="1" cellspacing="0" cellpadding="5"><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Statut</th><th>Date</th><th>Produit</th><th>Qté</th></tr>';
  transferts.forEach(t=>{
    if(t.products && t.products.length>0){
      t.products.forEach(p=>{
        html+=`<tr><td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.destinationLocation}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td><td>${t.createdAt.toLocaleString()}</td><td>${p.name}</td><td>${p.quantity}</td></tr>`;
      });
    } else {
      html+=`<tr><td>${t.code}</td><td>${t.senderFirstName} ${t.senderLastName}</td><td>${t.receiverFirstName} ${t.receiverLastName}</td><td>${t.destinationLocation}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recoveryAmount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td><td>${t.createdAt.toLocaleString()}</td><td></td><td></td></tr>`;
    }
  });
  html+='</table></body></html>';
  res.setHeader('Content-Type','application/msword');
  res.setHeader('Content-Disposition','attachment; filename="transferts.doc"');
  res.send(html);
});

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
