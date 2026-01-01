const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
app.use(express.urlencoded({extended:true}));
app.use(express.json());
app.use(session({secret:'transfert-secret-final',resave:false,saveUninitialized:true}));

mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('MongoDB connecté'))
.catch(console.error);

const transfertSchema = new mongoose.Schema({
  userType:{type:String,enum:['Client','Distributeur','Administrateur','Agence de transfert'],required:true},
  senderFirstName:String,senderLastName:String,senderPhone:String,originLocation:String,
  receiverFirstName:String,receiverLastName:String,receiverPhone:String,destinationLocation:String,
  amount:Number,fees:Number,recoveryAmount:Number,currency:{type:String,enum:['GNF','EUR','USD','XOF'],default:'GNF'},
  recoveryMode:String,retraitHistory:[{date:Date,mode:String}],retired:{type:Boolean,default:false},
  code:{type:String,unique:true},createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert',transfertSchema);

const authSchema = new mongoose.Schema({username:String,password:String,role:{type:String,enum:['admin','agent'],default:'agent'}});
const Auth = mongoose.model('Auth',authSchema);

async function generateUniqueCode(){
  let code, exists = true;
  while(exists){
    const letter = String.fromCharCode(65+Math.floor(Math.random()*26));
    const number = Math.floor(100+Math.random()*900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({code}).exec();
  }
  return code;
}

const requireLogin = (req,res,next)=>{if(req.session.user)return next();res.redirect('/login');};
function setPermissions(username){
  if(username==='a') return {lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true};
  if(username==='admin2') return {lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true};
  return {lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true};
}

const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];

app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
  .login-container{background:white;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);width:90%;max-width:360px;text-align:center;}
  .login-container h2{margin-bottom:30px;font-size:26px;color:#ff8c42;}
  .login-container input{width:100%;padding:15px;margin:10px 0;border:1px solid #ccc;border-radius:10px;font-size:16px;}
  .login-container button{padding:15px;width:100%;border:none;border-radius:10px;font-size:16px;background:#ff8c42;color:white;font-weight:bold;cursor:pointer;transition:0.3s;}
  .login-container button:hover{background:#e67300;}
  </style></head><body>
  <div class="login-container"><h2>Connexion</h2>
  <form method="post"><input name="username" placeholder="Utilisateur" required>
  <input type="password" name="password" placeholder="Mot de passe" required>
  <button>Se connecter</button></form></div></body></html>`);
});

app.post('/login',async(req,res)=>{
  const {username,password}=req.body;
  let user=await Auth.findOne({username}).exec();
  if(!user){const hashed=bcrypt.hashSync(password,10);user=await new Auth({username,password:hashed}).save();}
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={username:user.username,role:user.role,permissions:setPermissions(username)};
  res.redirect('/transferts');
});

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});

app.get('/transferts',requireLogin,async(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}th{background:#ff8c42;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}.delete{background:#dc3545;}.retirer{background:#ff9900;}.imprimer{background:#17a2b8;}
  input,select{padding:6px;margin-right:5px;}
  </style></head><body>
  <h2>📋 Liste des transferts</h2>
  <button onclick="showForm()">➕ Nouveau</button>
  <input id="searchInput" placeholder="Recherche...">
  <button onclick="loadList()">🔍</button>
  <div id="totaux"></div>
  <div id="formContainer" style="display:none;"></div>
  <div id="listContainer"></div>
  <script>
  const locations=${JSON.stringify(locations)};
  const currencies=${JSON.stringify(currencies)};
  const retraitModes=${JSON.stringify(retraitModes)};
  async function loadList(){
    const search=document.getElementById('searchInput').value;
    const res=await fetch('/transferts/ajax/list?search='+encodeURIComponent(search));
    const data=await res.json();
    renderList(data);
  }
  function renderList({transferts,totaux,permissions}){
    let tHTML='<h3>📊 Totaux</h3><table><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr>';
    for(let dest in totaux){for(let curr in totaux[dest]){
      tHTML+='<tr><td>'+dest+'</td><td>'+curr+'</td><td>'+totaux[dest][curr].amount+'</td><td>'+totaux[dest][curr].fees+'</td><td>'+totaux[dest][curr].recovery+'</td></tr>';
    }} tHTML+='</table>';
    document.getElementById('totaux').innerHTML=tHTML;
    let html='<table><tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Téléphone</th><th>Origine</th><th>Destinataire</th><th>Téléphone</th><th>Destination</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>';
    transferts.forEach(t=>{
      html+='<tr class="'+(t.retired?'retired':'')+'" data-id="'+t._id+'">'+
      '<td>'+t.code+'</td><td>'+t.userType+'</td>'+
      '<td>'+t.senderFirstName+' '+t.senderLastName+'</td><td>'+t.senderPhone+'</td><td>'+t.originLocation+'</td>'+
      '<td>'+t.receiverFirstName+' '+t.receiverLastName+'</td><td>'+t.receiverPhone+'</td><td>'+t.destinationLocation+'</td>'+
      '<td>'+t.amount+'</td><td>'+t.fees+'</td><td>'+t.recoveryAmount+'</td><td>'+t.currency+'</td>'+
      '<td>'+(t.retired?'Retiré':'Non retiré')+'</td><td>'+
      (permissions.modification?'<button class="modify" onclick="editTransfer(\\''+t.code+'\\')">✏️ Modifier</button>':'')+
      (permissions.suppression?'<button class="delete" onclick="deleteTransfer(\\''+t._id+'\\')">❌ Supprimer</button>':'')+
      (permissions.retrait&&!t.retired?'<select class="retirementMode">'+retraitModes.map(m=>'<option>'+m+'</option>').join('')+'</select><button class="retirer" onclick="retirer(\\''+t._id+'\\')">💰 Retirer</button>':'')+
      (permissions.imprimer?'<button onclick="window.open(\\'/transferts/print/'+t._id+'\\',\'_blank\')">🖨 Imprimer</button>':'')+
      '</td></tr>';
    });
    html+='</table>';
    document.getElementById('listContainer').innerHTML=html;
  }
  function showForm(code=''){
    fetch('/transferts/ajax/form?code='+code).then(r=>r.text()).then(html=>{
      document.getElementById('formContainer').style.display='block';
      document.getElementById('formContainer').innerHTML=html;
    });
  }
  async function saveForm(event){
    event.preventDefault();
    const data=new FormData(event.target);
    const obj={}; data.forEach((v,k)=>obj[k]=v);
    await fetch('/transferts/ajax/form',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
    document.getElementById('formContainer').style.display='none';
    loadList();
  }
  async function deleteTransfer(id){if(confirm('Confirmer?')){await fetch('/transferts/ajax/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});loadList();}}
  async function retirer(id){const tr=document.querySelector('tr[data-id="'+id+'"]');const mode=tr.querySelector('.retirementMode').value;await fetch('/transferts/ajax/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})});loadList();}
  function editTransfer(code){showForm(code);}
  loadList();
  </script></body></html>`);
});

// Routes AJAX
app.get('/transferts/ajax/list',requireLogin,async(req,res)=>{
  let {search=''}=req.query;
  let transferts=await Transfert.find().sort({createdAt:-1});
  const s=search.toLowerCase();
  transferts=transferts.filter(t=>t.code.toLowerCase().includes(s)||t.senderFirstName.toLowerCase().includes(s)||t.senderLastName.toLowerCase().includes(s)||t.senderPhone.toLowerCase().includes(s)||t.receiverFirstName.toLowerCase().includes(s)||t.receiverLastName.toLowerCase().includes(s)||t.receiverPhone.toLowerCase().includes(s));
  const totals={};
  transferts.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  });
  res.json({transferts,totaux:totals,permissions:req.session.user.permissions});
});

app.get('/transferts/ajax/form',requireLogin,async(req,res)=>{
  let t=null; if(req.query.code)t=await Transfert.findOne({code:req.query.code});
  const code=t?t.code:await generateUniqueCode();
  res.send(`<form onsubmit="saveForm(event)">
  <input name="code" value="${code}" readonly><label>Type</label><select name="userType">${['Client','Distributeur','Administrateur','Agence de transfert'].map(v=>`<option ${t&&t.userType===v?'selected':''}>${v}</option>`).join('')}</select>
  <label>Expéditeur Prénom</label><input name="senderFirstName" value="${t?t.senderFirstName:''}" required>
  <label>Expéditeur Nom</label><input name="senderLastName" value="${t?t.senderLastName:''}" required>
  <label>Expéditeur Téléphone</label><input name="senderPhone" value="${t?t.senderPhone:''}" required>
  <label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select>
  <label>Destinataire Prénom</label><input name="receiverFirstName" value="${t?t.receiverFirstName:''}" required>
  <label>Destinataire Nom</label><input name="receiverLastName" value="${t?t.receiverLastName:''}" required>
  <label>Destinataire Téléphone</label><input name="receiverPhone" value="${t?t.receiverPhone:''}" required>
  <label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select>
  <label>Montant</label><input type="number" name="amount" value="${t?t.amount:''}" required>
  <label>Frais</label><input type="number" name="fees" value="${t?t.fees:''}" required>
  <label>Montant à recevoir</label><input type="number" name="recoveryAmount" value="${t?t.recoveryAmount:''}" readonly>
  <label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select>
  <label>Mode de retrait</label><select name="recoveryMode">${retraitModes.map(m=>`<option ${t&&t.recoveryMode===m?'selected':''}>${m}</option>`).join('')}</select>
  <button>Enregistrer</button></form>`);
});

app.post('/transferts/ajax/form',requireLogin,async(req,res)=>{
  const amount=Number(req.body.amount||0);const fees=Number(req.body.fees||0);
  const recoveryAmount=amount-fees; const code=req.body.code||await generateUniqueCode();
  let existing=await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body,amount,fees,recoveryAmount});
  else await new Transfert({...req.body,amount,fees,recoveryAmount,code,retraitHistory:[]}).save();
  res.json({ok:true});
});

app.post('/transferts/ajax/delete',requireLogin,async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndDelete(req.body.id);res.json({ok:true});
});

app.post('/transferts/ajax/retirer',requireLogin,async(req,res)=>{
  if(!req.session.user.permissions.retrait) return res.status(403).send('Accès refusé');
  await Transfert.findByIdAndUpdate(req.body.id,{retired:true,recoveryMode:req.body.mode,$push:{retraitHistory:{date:new Date(),mode:req.body.mode}}});
  res.json({ok:true});
});

app.get('/transferts/print/:id',requireLogin,async(req,res)=>{
  const t=await Transfert.findById(req.params.id);if(!t)return res.send('Transfert introuvable');
  res.send(`<html><body><h3>💰 Transfert</h3><p>Code: ${t.code}</p>
  <p>Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
  <p>Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
  <p>Montant: ${t.amount} ${t.currency}</p><p>Frais: ${t.fees}</p><p>Reçu: ${t.recoveryAmount}</p>
  <p>Status: ${t.retired?'Retiré':'Non retiré'}</p><button onclick="window.print()">🖨 Imprimer</button></body></html>`);
});

app.get('/transferts/pdf',requireLogin,async(req,res)=>{
  const transferts=await Transfert.find().sort({createdAt:-1});
  const doc=new PDFDocument({margin:30,size:'A4'});
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="transferts.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Liste des transferts',{align:'center'}).moveDown();
  transferts.forEach(t=>doc.fontSize(12).text(`${t.code} - ${t.senderFirstName} ${t.senderLastName} -> ${t.receiverFirstName} ${t.receiverLastName} : ${t.amount} ${t.currency} [${t.retired?'Retiré':'Non retiré'}]`));
  doc.end();
});

app.get('/transferts/excel',requireLogin,async(req,res)=>{
  const transferts=await Transfert.find().sort({createdAt:-1});
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('Transferts');
  sheet.columns=[{header:'Code',key:'code'},{header:'Expéditeur',key:'exp'},{header:'Destinataire',key:'dest'},
    {header:'Montant',key:'amount'},{header:'Frais',key:'fees'},{header:'Reçu',key:'recovery'},{header:'Devise',key:'currency'},{header:'Status',key:'status'}];
  transferts.forEach(t=>sheet.addRow({code:t.code,exp:t.senderFirstName+' '+t.senderLastName,dest:t.receiverFirstName+' '+t.receiverLastName,
    amount:t.amount,fees:t.fees,recovery:t.recoveryAmount,currency:t.currency,status:t.retired?'Retiré':'Non retiré'}));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="transferts.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.listen(process.env.PORT||3000,()=>console.log('Serveur démarré'));
