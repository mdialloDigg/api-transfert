/******************************************************************
 * APP TRANSFERT – DASHBOARD FINAL AJAX + EXPORT EXCEL/WORD
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

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
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username:String, password:String,
  role:{type:String, enum:['admin','agent'], default:'agent'}
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode() {
  let code; let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH / PERMISSIONS =================
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  let permissions = { lecture:true, ecriture:false, retrait:false, modification:true, suppression:true, imprimer:true };
  if(username === 'a'){ permissions = { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true }; }
  if(username === 'admin2'){ permissions = { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true }; }
  return permissions;
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

// ================= LOGIN / LOGOUT =================
app.get('/login',(req,res)=>{
  res.send(`<html><body>
  <form method="post">
  <input name="username" placeholder="Utilisateur" required>
  <input type="password" name="password" placeholder="Mot de passe" required>
  <button>Connexion</button>
  </form></body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const { username, password } = req.body;
    let user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      user = await new Auth({ username, password: hashed }).save();
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    const permissions = setPermissions(username);
    req.session.user = { username:user.username, role:user.role, permissions };
    res.redirect('/transferts/list');
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur: '+err.message);}
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(`<html><body>
  <form method="post">
  Type: <select name="userType">
    <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
    <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
    <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
    <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
  </select><br>
  Expéditeur: <input name="senderFirstName" value="${t?t.senderFirstName:''}"> <input name="senderLastName" value="${t?t.senderLastName:''}"> <input name="senderPhone" value="${t?t.senderPhone:''}"><br>
  Destinataire: <input name="receiverFirstName" value="${t?t.receiverFirstName:''}"> <input name="receiverLastName" value="${t?t.receiverLastName:''}"> <input name="receiverPhone" value="${t?t.receiverPhone:''}"><br>
  Montant: <input type="number" name="amount" id="amount" value="${t?t.amount:''}"> Frais: <input type="number" name="fees" id="fees" value="${t?t.fees:''}"> Reçu: <input type="text" id="recoveryAmount" value="${t?t.recoveryAmount:''}" readonly><br>
  Devise: <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select><br>
  Code: <input name="code" value="${code}" readonly><br>
  <button>Enregistrer</button>
  </form>
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
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, code}).save();
  res.redirect('/transferts/list');
});

// ================= RETRAIT / SUPPRESSION =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true});
  res.send({success:true});
});

app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.send({success:true});
});

// ================= LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const optionsCurrency = currencies.map(c=>`<option value="${c}">${c}</option>`).join('');
  const optionsLocation = locations.map(l=>`<option value="${l}">${l}</option>`).join('');
  res.send(`<html><body>
  <h2>Liste des transferts</h2>
  <input id="search" placeholder="Recherche...">
  <select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
  <select id="currency"><option value="">Toutes devises</option>${optionsCurrency}</select>
  <select id="destination"><option value="">Toutes destinations</option>${optionsLocation}</select>
  <button onclick="loadData()">Filtrer</button>
  <a href="/logout">Déconnexion</a>
  <a href="/transferts/excel">Excel</a>
  <a href="/transferts/word">Word</a>
  <table border="1"><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody id="tbody"></tbody></table>
  <div id="totaux"></div>
  <script>
  async function loadData(){
    const search = encodeURIComponent(document.getElementById('search').value);
    const status = document.getElementById('status').value;
    const currency = document.getElementById('currency').value;
    const destination = document.getElementById('destination').value;
    const resp = await fetch(\`/transferts/data?search=\${search}&status=\${status}&currency=\${currency}&destination=\${destination}\`);
    const data = await resp.json();
    const tbody = document.getElementById('tbody'); tbody.innerHTML='';
    const totals={};
    data.forEach(t=>{
      const tr=document.createElement('tr'); if(t.retired) tr.className='retired';
      tr.innerHTML='<td>'+t.code+'</td><td>'+t.userType+'</td><td>'+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')</td><td>'+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')</td><td>'+t.amount+'</td><td>'+t.fees+'</td><td>'+t.recoveryAmount+'</td><td>'+t.currency+'</td><td>'+(t.retired?'Retiré':'Non retiré')+'</td><td><button onclick="edit(\''+t._id+'\')">✏️</button><button onclick="removeRow(\''+t._id+'\')">❌</button><button onclick="retirer(\''+t._id+'\')">💰</button><button onclick="imprimer(\''+t._id+'\')">🖨</button></td>';
      tbody.appendChild(tr);
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
    });
    const divtot=document.getElementById('totaux'); divtot.innerHTML='';
    for(const dest in totals){
      for(const curr in totals[dest]){
        divtot.innerHTML+='<p>'+dest+' | '+curr+' : Montant='+totals[dest][curr].amount+', Frais='+totals[dest][curr].fees+', Reçu='+totals[dest][curr].recovery+'</p>';
      }
    }
  }
  function edit(id){alert('Modifier '+id);}
  function removeRow(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
  function retirer(id){const mode=prompt('Mode de retrait: Espèces, Orange Money, Wave'); if(mode) fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);}
  function imprimer(id){window.open('/transferts/print/'+id,'_blank');}
  window.onload=loadData;
  </script>
  </body></html>`);
});

// ================= DATA AJAX =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  const { search='', status='all', currency='', destination='' } = req.query;
  let transferts = await Transfert.find().lean();
  const s = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return (!s || t.code.toLowerCase().includes(s) || t.senderFirstName.toLowerCase().includes(s) || t.receiverFirstName.toLowerCase().includes(s))
      && (status==='all' || (status==='retire'?t.retired:true))
      && (!currency || t.currency===currency)
      && (!destination || t.destinationLocation===destination);
  });
  res.json(transferts);
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns=[
    {header:'Code', key:'code'}, {header:'Type', key:'userType'},
    {header:'Expéditeur', key:'sender'}, {header:'Destinataire', key:'receiver'},
    {header:'Montant', key:'amount'}, {header:'Frais', key:'fees'}, {header:'Reçu', key:'recoveryAmount'},
    {header:'Devise', key:'currency'}, {header:'Status', key:'status'}
  ];
  transferts.forEach(t=>{
    sheet.addRow({
      code:t.code, userType:t.userType,
      sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
      receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
      amount:t.amount, fees:t.fees, recoveryAmount:t.recoveryAmount,
      currency:t.currency, status:t.retired?'Retiré':'Non retiré'
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const doc = new Document();
  const children = transferts.map(t => new Paragraph({
    children: [
      new TextRun(`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Status: ${t.retired?'Retiré':'Non retiré'}`)
    ]
  }));
  doc.addSection({ children });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= PRINT SINGLE =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body>
  <h2>Transfert ${t.code}</h2>
  <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
  <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
  <p>Montant: ${t.amount} ${t.currency}</p>
  <p>Frais: ${t.fees}</p>
  <p>Reçu: ${t.recoveryAmount}</p>
  <script>window.print();</script>
  </body></html>`);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
