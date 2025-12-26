/****************************************************
 * SERVEUR TRANSFERT COMPLET – UN SEUL FICHIER
 ****************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'secret-transfert', resave: false, saveUninitialized: true }));

// =================== DATABASE ===================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert', { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(console.error);

const transfertSchema = new mongoose.Schema({
  userType: String,
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
  currency: String,
  retired: { type: Boolean, default: false },
  retraitHistory: [{ date: Date, mode: String }],
  code: { type: String, unique: true }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

// =================== AUTH ===================
const authSchema = new mongoose.Schema({ username:String, password:String, role:String });
const Auth = mongoose.model('Auth', authSchema);

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };

// =================== UTILS ===================
async function generateUniqueCode() {
  let code; let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random()*26));
    const number = Math.floor(100 + Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// =================== LOGIN / LOGOUT ===================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
  form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
  input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
  button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;}
  button:hover{background:#0056b3;}
  </style></head><body>
  <h2>Connexion</h2>
  <form method="post">
    <input name="username" placeholder="Utilisateur" required><br>
    <input type="password" name="password" placeholder="Mot de passe" required><br>
    <button>Connexion</button>
  </form></body></html>`);
});

app.post('/login', async(req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    user = await new Auth({ username, password: hashed, role:'admin' }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username:user.username, role:user.role };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// =================== FORMULAIRE ===================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  const t = req.query.id ? await Transfert.findById(req.query.id) : null;
  const code = t ? t.code : await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
  .container{max-width:800px;margin:40px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
  h2{color:#2c7be5;text-align:center;margin-bottom:20px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:15px;}
  label{display:block;margin-bottom:5px;font-weight:bold;color:#555;}
  input,select{width:100%;padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
  input[readonly]{background:#e9ecef;}
  button{width:100%;padding:12px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;}
  button:hover{background:#218838;}
  a{display:inline-block;margin-top:15px;color:#2c7be5;text-decoration:none;font-weight:bold;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <div class="container">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
  <div class="grid">
    <div><label>Type</label><select name="userType">
      <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
      <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
      <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
      <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
    </select></div>
    <div><label>Expéditeur Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required></div>
    <div><label>Expéditeur Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required></div>
    <div><label>Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required></div>
    <div><label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
    <div><label>Destinataire Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required></div>
    <div><label>Destinataire Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required></div>
    <div><label>Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required></div>
    <div><label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
    <div><label>Montant</label><input type="number" id="amount" name="amount" value="${t?t.amount:0}" required></div>
    <div><label>Frais</label><input type="number" id="fees" name="fees" value="${t?t.fees:0}" required></div>
    <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:0}"></div>
    <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div><label>Code</label><input type="text" name="code" value="${code}" readonly></div>
  </div>
  <button>${t?'Enregistrer Modifications':'Créer Transfert'}</button>
  </form>
  <center><a href="/transferts/list">⬅ Retour liste</a></center>
  </div>
  <script>
  const amountField = document.getElementById('amount');
  const feesField = document.getElementById('fees');
  const recoveryField = document.getElementById('recoveryAmount');
  function updateRecovery(){const a=parseFloat(amountField.value)||0;const f=parseFloat(feesField.value)||0;recoveryField.value=a-f;}
  amountField.addEventListener('input',updateRecovery);
  feesField.addEventListener('input',updateRecovery);
  updateRecovery();
  </script>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount || 0);
  const fees = Number(req.body.fees || 0);
  const recoveryAmount = amount - fees;
  const existing = await Transfert.findOne({ code:req.body.code });
  if(existing) {
    await Transfert.findByIdAndUpdate(existing._id,{ ...req.body, amount, fees, recoveryAmount });
  } else {
    await new Transfert({ ...req.body, amount, fees, recoveryAmount, retraitHistory: [] }).save();
  }
  res.redirect('/transferts/list');
});

// =================== LISTE ===================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const locOptions = locations.map(l=>`<option value="${l}">${l}</option>`).join('');
  const currOptions = currencies.map(c=>`<option value="${c}">${c}</option>`).join('');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#007bff;color:white;}.retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}.delete{background:#dc3545;}.retirer{background:#ff9900;}.imprimer{background:#17a2b8;}
  @media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <div>
    <input id="search" placeholder="Recherche...">
    <select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
    <select id="currency"><option value="">Toutes devises</option>${currOptions}</select>
    <select id="destination"><option value="">Toutes destinations</option>${locOptions}</select>
    <button onclick="loadData()">🔍 Filtrer</button>
    <a href="/logout">🚪 Déconnexion</a>
    <a href="/transferts/form">➕ Nouveau</a>
    <table><thead><tr>
      <th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th>
      <th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody id="tbody"></tbody></table>
    <h3>📊 Totaux par destination et devise</h3><div id="totaux"></div>
  </div>
  <script>
  async function loadData(){
    const search=document.getElementById('search').value;
    const status=document.getElementById('status').value;
    const currency=document.getElementById('currency').value;
    const destination=document.getElementById('destination').value;
    const resp = await fetch('/transferts/data?search='+encodeURIComponent(search)+'&status='+encodeURIComponent(status)+'&currency='+encodeURIComponent(currency)+'&destination='+encodeURIComponent(destination));
    const data = await resp.json();
    const tbody=document.getElementById('tbody'); tbody.innerHTML='';
    const totals={};
    data.forEach(t=>{
      const tr=document.createElement('tr');
      if(t.retired) tr.className='retired';
      tr.innerHTML='<td>'+t.code+'</td><td>'+t.userType+'</td><td>'+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')</td><td>'+t.originLocation+'</td><td>'+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')</td><td>'+t.amount+'</td><td>'+t.fees+'</td><td>'+t.recoveryAmount+'</td><td>'+t.currency+'</td><td>'+(t.retired?'Retiré':'Non retiré')+'</td><td>'+
        '<button class="modify" onclick="edit(\\''+t._id+'\\')">✏️</button>'+
        '<button class="delete" onclick="remove(\\''+t._id+'\\')">❌</button>'+
        '<button class="retirer" onclick="retirer(\\''+t._id+'\\')">💰</button>'+
        '<button class="imprimer" onclick="imprimer(\\''+t._id+'\\')">🖨</button>'+
        '</td>';
      tbody.appendChild(tr);

      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount += t.amount;
      totals[t.destinationLocation][t.currency].fees += t.fees;
      totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
    });
    const divtot=document.getElementById('totaux'); divtot.innerHTML='';
    for(const dest in totals){
      for(const curr in totals[dest]){
        divtot.innerHTML+='<p>'+dest+' | '+curr+' : Montant='+totals[dest][curr].amount+', Frais='+totals[dest][curr].fees+', Reçu='+totals[dest][curr].recovery+'</p>';
      }
    }
  }
  function edit(id){window.location='/transferts/form?id='+id;}
  function remove(id){if(confirm('Supprimer ce transfert ?')) fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
  function retirer(id){const mode=prompt('Mode de retrait: Espèces, Orange Money, Wave'); if(mode) fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);}
  function imprimer(id){window.open('/transferts/print/'+id,'_blank');}
  window.onload=loadData;
  </script>
  </body></html>`);
});

// =================== AJAX DATA ===================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  const filter={};
  if(req.query.search) filter.code={ $regex:req.query.search, $options:'i' };
  if(req.query.status==='retire') filter.retired=true;
  if(req.query.status==='non') filter.retired=false;
  if(req.query.currency) filter.currency=req.query.currency;
  if(req.query.destination) filter.destinationLocation=req.query.destination;
  const transferts = await Transfert.find(filter).sort({createdAt:-1});
  res.json(transferts);
});

// =================== RETRAIT / SUPPRESSION ===================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.body.id);
  if(t){
    t.retired=true;
    t.retraitHistory.push({date:new Date(), mode:req.body.mode});
    await t.save();
  }
  res.json({success:true});
});

app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

// =================== SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur le port',PORT));
