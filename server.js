/******************************************************************
 * APP TRANSFERT + MINI-ADMIN UTILISATEURS (TEST PRÊT)
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

// ================= DATABASE TRANSFERT =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB transferts connecté'))
  .catch(console.error);

// ================= SCHEMA TRANSFERT =================
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName:String, senderLastName:String, senderPhone:String, originLocation:String,
  receiverFirstName:String, receiverLastName:String, receiverPhone:String, destinationLocation:String,
  amount:Number, fees:Number, recoveryAmount:Number, currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String, retraitHistory:[{ date:Date, mode:String }], retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true }, createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

// ================= SCHEMA AUTH =================
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
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];
const retraitModes = ['Espèces','Virement','Orange Money','Wave'];
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){ return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true }; }

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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

// ================= SEED TRANSFERTS =================
async function seedTransferts(){
  const count = await Transfert.countDocuments();
  if(count>0) return;
  for(let i=1;i<=10;i++){
    const amount = 100*i;
    const fees = 10*i;
    const recovery = amount - fees;
    const code = await generateUniqueCode();
    await new Transfert({
      userType: 'Client',
      senderFirstName:'Exp'+i, senderLastName:'Test'+i, senderPhone:'2210000'+i, originLocation:'Conakry',
      receiverFirstName:'Dest'+i, receiverLastName:'Test'+i, receiverPhone:'2211000'+i, destinationLocation:'France',
      amount, fees, recoveryAmount:recovery, currency:'USD', recoveryMode:'Espèces', code
    }).save();
  }
}
seedTransferts();

// ================= DATABASE USERS =================
const mongoose2 = require('mongoose');
const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/test';
mongoose2.connect(MONGODB_TEST_URI)
  .then(()=>console.log('✅ MongoDB utilisateurs connecté'))
  .catch(err=>console.error('❌ Erreur connexion test', err));

const userSchema = new mongoose2.Schema({}, { strict: false });
const User = mongoose2.model('User', userSchema, 'users');

// ================= SEED USERS =================
async function seedUsers(){
  const count = await User.countDocuments();
  if(count>0) return;
  for(let i=1;i<=10;i++){
    await new User({ username:'user'+i, email:'user'+i+'@test.com', role:'agent', password:'pass'+i });
  }
}
seedUsers();

// ================= MINI-ADMIN USERS =================
app.get('/users/list', requireLogin, async (req,res)=>{
  const { search='', page=1 } = req.query;
  const limit = 20;
  const skip = (page-1)*limit;

  let query = {};
  if(search) query = { $or:[ { username: { $regex: search, $options:'i' } }, { email: { $regex: search, $options:'i' } } ]};

  const total = await User.countDocuments(query);
  const users = await User.find(query).skip(skip).limit(limit);
  const totalPages = Math.ceil(total/limit);

  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#f4f6f9;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#ff8c42;color:white;}
  input,select{padding:6px;margin:2px;border-radius:5px;border:1px solid #ccc;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}.delete{background:#dc3545;}
  #modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);justify-content:center;align-items:center;}
  #modal .content{background:white;padding:20px;border-radius:10px;width:90%;max-width:400px;}
  </style></head><body>
  <h2>📋 Liste des utilisateurs</h2>
  <table><thead><tr>`;

  if(users.length>0){
    Object.keys(users[0].toObject()).forEach(k=>html+=`<th>${k}</th>`); html+='<th>Actions</th>';
  }
  html+='</tr></thead><tbody>';
  users.forEach(u=>{
    const obj = u.toObject();
    html+='<tr data-id="'+u._id+'">';
    Object.keys(obj).forEach(k=>html+=`<td class="field-${k}">${obj[k]}</td>`);
    html+=`<td><button class="modify">✏️ Modifier</button><button class="delete">❌ Supprimer</button></td></tr>`;
  });
  html+='</tbody></table>';

  html+='<div>';
  for(let i=1;i<=totalPages;i++) html+=`<a href="#" class="page" data-page="${i}">${i}</a> `;
  html+='</div>';

  html+=`<div id="modal"><div class="content"><h3>Modifier utilisateur</h3><form id="editForm"></form><button id="closeModal">❌ Fermer</button></div></div>`;

  html+=`<script>
  const modal=document.getElementById('modal'); const editForm=document.getElementById('editForm');
  const closeModal=document.getElementById('closeModal');
  document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{
    if(confirm('❌ Confirmer suppression ?')){
      const tr=btn.closest('tr'); const id=tr.dataset.id;
      const res=await fetch('/users/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      const data=await res.json(); if(data.ok) tr.remove();
    }
  });
  document.querySelectorAll('.modify').forEach(btn=>btn.onclick=e=>{
    const tr=btn.closest('tr'); const id=tr.dataset.id;
    editForm.innerHTML=''; tr.querySelectorAll('td').forEach(td=>{
      if(td.className.startsWith('field-')){
        const key=td.className.replace('field-',''); editForm.innerHTML+='<label>'+key+'</label><input name="'+key+'" value="'+td.innerText+'"><br>';
      }
    });
    editForm.innerHTML+='<button type="submit">💾 Enregistrer</button>'; modal.style.display='flex';
    editForm.onsubmit=async ev=>{
      ev.preventDefault(); const formData=Object.fromEntries(new FormData(editForm).entries());
      const res=await fetch('/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,...formData})});
      const data=await res.json();
      if(data.ok){ Object.keys(formData).forEach(k=>tr.querySelector('.field-'+k).innerText=formData[k]); modal.style.display='none'; } else alert('Erreur:'+data.message);
    };
  });
  closeModal.onclick=()=>{modal.style.display='none';};
  document.querySelectorAll('.page').forEach(p=>p.onclick=e=>{e.preventDefault(); const page=p.dataset.page; window.location.href='/users/list?page='+page;});
  </script>`;

  res.send(html);
});

app.post('/users/delete', requireLogin, async(req,res)=>{ const {id}=req.body; await User.findByIdAndDelete(id); res.send({ok:true}); });
app.post('/users/update', requireLogin, async(req,res)=>{ const {id,...data}=req.body; await User.findByIdAndUpdate(id,data); res.send({ok:true}); });

// ================= SERVER =================
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'));
