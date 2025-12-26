/******************************************************************
 * APP TRANSFERT – VERSION TOUT-EN-UN AVEC EXCEL & WORD
 ******************************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret', resave: false, saveUninitialized: true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('MongoDB connecté')).catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: String, senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:String, recoveryMode:String, retraitHistory:Array,
  retired:{type:Boolean,default:false}, code:{type:String,unique:true}, createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);
const authSchema = new mongoose.Schema({ username:String,password:String,role:String });
const Auth = mongoose.model('Auth',authSchema);

// ================= UTIL =================
async function generateCode(){let c,exists=true;while(exists){c=String.fromCharCode(65+Math.floor(Math.random()*26))+Math.floor(100+Math.random()*900);exists=await Transfert.findOne({code:c});}return c;}
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const requireLogin = (req,res,next)=>{if(req.session.user)return next();res.redirect('/login');};

// ================= LOGIN =================
app.get('/login',(req,res)=>res.send(`
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px}form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block}input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc}button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer}button:hover{background:#0056b3}</style></head>
<body><h2>Connexion</h2><form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form></body></html>
`));

app.post('/login',async(req,res)=>{
  const {username,password} = req.body;
  let user = await Auth.findOne({username});
  if(!user){const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed,role:'agent'}).save();}
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role};
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});

// ================= FORMULAIRE =================
app.get('/transferts/form',requireLogin,async(req,res)=>{
  const t = req.query.code ? await Transfert.findOne({code:req.query.code}) : null;
  const code = t ? t.code : await generateCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}.container{max-width:800px;margin:40px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15)}
  h2{color:#2c7be5;text-align:center;margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:15px}
  label{display:block;margin-bottom:5px;font-weight:bold;color:#555}input,select{width:100%;padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px}input[readonly]{background:#e9ecef}
  button{width:100%;padding:12px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:0.3s}button:hover{background:#218838}a{display:inline-block;margin-top:15px;color:#2c7be5;text-decoration:none;font-weight:bold}a:hover{text-decoration:underline}
  </style></head><body><div class="container">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
  <select name="userType"><option ${t&&t.userType==='Client'?'selected':''}>Client</option><option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option><option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option><option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option></select>
  <div class="grid">
  <div><label>Prénom expéditeur</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required></div>
  <div><label>Nom expéditeur</label><input name="senderLastName" value="${t?t.senderLastName:''}" required></div>
  <div><label>Téléphone expéditeur</label><input name="senderPhone" value="${t?t.senderPhone:''}" required></div>
  <div><label>Origine</label><select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
  <div><label>Prénom destinataire</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required></div>
  <div><label>Nom destinataire</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required></div>
  <div><label>Téléphone destinataire</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required></div>
  <div><label>Destination</label><select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select></div>
  <div><label>Montant</label><input type="number" id="amount" name="amount" value="${t?t.amount:''}" required></div>
  <div><label>Frais</label><input type="number" id="fees" name="fees" value="${t?t.fees:''}" required></div>
  <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
  <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
  <div><label>Code</label><input name="code" readonly value="${code}"></div>
  </div>
  <button>${t?'Modifier':'Enregistrer'}</button></form>
  <center><a href="/transferts/list">⬅ Retour liste</a></center>
  </div>
  <script>
  const a=document.getElementById('amount'),f=document.getElementById('fees'),r=document.getElementById('recoveryAmount');
  function updateR(){r.value=(parseFloat(a.value)||0)-(parseFloat(f.value)||0);}
  a.addEventListener('input',updateR); f.addEventListener('input',updateR); updateR();
  </script>
  </body></html>`);
});

app.post('/transferts/form',requireLogin,async(req,res)=>{
  const amount=Number(req.body.amount||0),fees=Number(req.body.fees||0),recoveryAmount=amount-fees;
  const code=req.body.code||await generateCode();
  let t=await Transfert.findOne({code});
  if(t) await Transfert.findByIdAndUpdate(t._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount,retraitHistory:[],code}).save();
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list',requireLogin,(req,res)=>{
  let optionsCurrency=currencies.map(c=>`<option value="${c}">${c}</option>`).join('');
  let optionsLocation=locations.map(l=>`<option value="${l}">${l}</option>`).join('');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9}table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px}th{background:#007bff;color:white}.retired{background:#fff3b0}button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px}.modify{background:#28a745}.delete{background:#dc3545}.retirer{background:#ff9900}.imprimer{background:#17a2b8}@media(max-width:600px){table,th,td{font-size:12px}button{padding:3px 5px}}</style></head><body>
  <h2>📋 Liste des transferts</h2>
  <input id="search" placeholder="Recherche...">
  <select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
  <select id="currency"><option value="">Toutes devises</option>${optionsCurrency}</select>
  <select id="destination"><option value="">Toutes destinations</option>${optionsLocation}</select>
  <button onclick="loadData()">🔍 Filtrer</button>
  <a href="/logout">🚪 Déconnexion</a>
  <a href="/transferts/excel">📊 Excel</a>
  <a href="/transferts/word">📝 Word</a>
  <table><thead><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead><tbody id="tbody"></tbody></table>
  <div id="totaux"></div>
  <script>
  async function loadData(){
    var s=document.getElementById('search').value,st=document.getElementById('status').value,c=document.getElementById('currency').value,d=document.getElementById('destination').value;
    var res=await fetch('/transferts/data?search='+encodeURIComponent(s)+'&status='+encodeURIComponent(st)+'&currency='+encodeURIComponent(c)+'&destination='+encodeURIComponent(d));
    var data=await res.json(),tbody=document.getElementById('tbody');tbody.innerHTML='';var totals={};
    data.forEach(function(t){
      var tr=document.createElement('tr'); if(t.retired)tr.className='retired';
      tr.innerHTML='<td>'+t.code+'</td><td>'+t.userType+'</td><td>'+t.senderFirstName+' '+t.senderLastName+' ('+t.senderPhone+')</td><td>'+t.originLocation+'</td><td>'+t.receiverFirstName+' '+t.receiverLastName+' ('+t.receiverPhone+')</td><td>'+t.amount+'</td><td>'+t.fees+'</td><td>'+t.recoveryAmount+'</td><td>'+t.currency+'</td><td>'+(t.retired?'Retiré':'Non retiré')+'</td><td><button class="modify" onclick="edit(\''+t._id+'\')">✏️</button><button class="delete" onclick="removeT(\''+t._id+'\')">❌</button><button class="retirer" onclick="retirer(\''+t._id+'\')">💰</button><button class="imprimer" onclick="imprimer(\''+t._id+'\')">🖨</button></td>';
      tbody.appendChild(tr);
      if(!totals[t.destinationLocation])totals[t.destinationLocation]={}; if(!totals[t.destinationLocation][t.currency])totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
    });
    var div=document.getElementById('totaux'); div.innerHTML=''; for(var dest in totals){for(var curr in totals[dest]){div.innerHTML+='<p>'+dest+' | '+curr+' : Montant='+totals[dest][curr].amount+', Frais='+totals[dest][curr].fees+', Reçu='+totals[dest][curr].recovery+'</p>';}}
  }
  function edit(id){window.location='/transferts/form?code='+id;}
  function removeT(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
  function retirer(id){var m=prompt('Mode de retrait: Espèces, Orange Money, Wave'); if(m)fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode:m})}).then(loadData);}
  function imprimer(id){window.open('/transferts/print/'+id,'_blank');}
  window.onload=loadData;
  </script>
  </body></html>`);
});

// ================= DATA AJAX =================
app.get('/transferts/data',requireLogin,async(req,res)=>{
  let t=await Transfert.find().sort({createdAt:-1}).exec();
  const {search='',status='all',currency='',destination=''}=req.query;
  if(search)t=t.filter(x=>x.code.includes(search));
  if(status==='retire')t=t.filter(x=>x.retired);
  if(status==='non')t=t.filter(x=>!x.retired);
  if(currency)t=t.filter(x=>x.currency===currency);
  if(destination)t=t.filter(x=>x.destinationLocation===destination);
  res.json(t);
});

// ================= DELETE =================
app.delete('/transferts/delete/:id',requireLogin,async(req,res)=>{await Transfert.findByIdAndDelete(req.params.id);res.sendStatus(200);});

// ================= RETIRER =================
app.post('/transferts/retirer',requireLogin,async(req,res)=>{
  const {id,mode} = req.body;
  let t = await Transfert.findById(id);
  if(t){ t.retired = true; t.recoveryMode = mode; t.retraitHistory.push({date:new Date(),mode}); await t.save();}
  res.sendStatus(200);
});

// ================= EXCEL =================
app.get('/transferts/excel',requireLogin,async(req,res)=>{
  const t = await Transfert.find().sort({createdAt:-1});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [{header:'Code',key:'code'},{header:'Type',key:'userType'},{header:'Expéditeur',key:'sender'},
    {header:'Origine',key:'origin'},{header:'Destinataire',key:'receiver'},{header:'Montant',key:'amount'},
    {header:'Frais',key:'fees'},{header:'Reçu',key:'recovery'},{header:'Devise',key:'currency'},{header:'Status',key:'status'}];
  t.forEach(x=>sheet.addRow({code:x.code,userType:x.userType,sender:`${x.senderFirstName} ${x.senderLastName}`,origin:x.originLocation,receiver:`${x.receiverFirstName} ${x.receiverLastName}`,amount:x.amount,fees:x.fees,recovery:x.recoveryAmount,currency:x.currency,status:x.retired?'Retiré':'Non retiré'}));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res); res.end();
});

// ================= WORD =================
app.get('/transferts/word',requireLogin,async(req,res)=>{
  const t = await Transfert.find().sort({createdAt:-1});
  const doc = new Document();
  t.forEach(x=>{
    doc.addSection({children:[new Paragraph({children:[new TextRun(`Code: ${x.code} | Expéditeur: ${x.senderFirstName} ${x.senderLastName} | Destinataire: ${x.receiverFirstName} ${x.receiverLastName} | Montant: ${x.amount} ${x.currency} | Status: ${x.retired?'Retiré':'Non retiré'}`)])}]});
  });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= START =================
const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log('🚀 Serveur démarré sur http://localhost:'+PORT));
