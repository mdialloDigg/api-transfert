/********************************************************************
 * APPLICATION TRANSFERT – VERSION FINALE COMPLÈTE
 ********************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();

/* ================= CONFIG ================= */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'transfert-secret-final',
  resave: false,
  saveUninitialized: true
}));

/* ================= DATABASE ================= */
mongoose.connect('mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(console.error);

/* ================= MODELS ================= */
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
  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String
});
const Auth = mongoose.model('Auth', authSchema);

/* ================= AUTH ================= */
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

function permissionsFor(user){
  if(user === 'a'){
    return { read:true, create:false, edit:false, delete:false, withdraw:true, print:true };
  }
  if(user === 'admin2'){
    return { read:true, create:true, edit:true, delete:true, withdraw:false, print:true };
  }
  return { read:true, create:true, edit:true, delete:true, withdraw:true, print:true };
}

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
  res.send(`<form method="post" style="text-align:center;margin-top:100px">
  <h2>Connexion</h2>
  <input name="username" placeholder="Utilisateur" required><br><br>
  <input type="password" name="password" placeholder="Mot de passe" required><br><br>
  <button>Connexion</button>
  </form>`);
});

app.post('/login', async(req,res)=>{
  let u = await Auth.findOne({ username:req.body.username });
  if(!u){
    u = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10)
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,u.password)) return res.send('Mot de passe incorrect');

  req.session.user = {
    username:u.username,
    permissions:permissionsFor(u.username)
  };
  res.redirect('/transferts/list');
});

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

/* ================= LISTE TRANSFERTS ================= */
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const { search='', status='all' } = req.query;
  let data = await Transfert.find().sort({createdAt:-1});

  if(search){
    const s = search.toLowerCase();
    data = data.filter(t =>
      t.code.toLowerCase().includes(s) ||
      t.senderPhone.includes(s) ||
      t.receiverPhone.includes(s)
    );
  }
  if(status==='retire') data = data.filter(t=>t.retired);
  if(status==='non') data = data.filter(t=>!t.retired);

  /* === TOTAUX PAR DESTINATION + DEVISE === */
  const totals = {};
  data.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency])
      totals[t.destinationLocation][t.currency]={ amount:0, fees:0, recovery:0 };
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  });

  let html = `
<html><head><style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px}
th,td{border:1px solid #ccc;padding:6px;font-size:14px}
th{background:#007bff;color:white}
.retired{background:#fff7cc}
.actions button{margin:2px}
.total-table th{background:#343a40}
.total-table tr:nth-child(even){background:#f1f3f5}
</style></head><body>

<h2>📊 Totaux par destination et devise</h2>
<table class="total-table">
<tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr>`;

  for(let d in totals){
    for(let c in totals[d]){
      const t = totals[d][c];
      html+=`<tr><td>${d}</td><td>${c}</td><td>${t.amount}</td><td>${t.fees}</td><td>${t.recovery}</td></tr>`;
    }
  }

  html+=`</table>

<form method="get">
<input name="search" value="${search}" placeholder="Recherche">
<select name="status">
<option value="all">Tous</option>
<option value="retire">Retirés</option>
<option value="non">Non retirés</option>
</select>
<button>Filtrer</button>
</form>

<button onclick="window.open('/transferts/print-bulk?search=${search}&status=${status}')">
🖨 Imprimer tous les tickets filtrés
</button>

<h2>📋 Liste des transferts</h2>
<table>
<tr>
<th>Code</th><th>Expéditeur</th><th>Destinataire</th>
<th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th>
</tr>`;

  data.forEach(t=>{
    html+=`<tr class="${t.retired?'retired':''}">
<td>${t.code}</td>
<td>${t.senderPhone}</td>
<td>${t.receiverPhone}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Non retiré'}</td>
<td class="actions">
${req.session.user.permissions.withdraw && !t.retired ?
`<form method="post" action="/transferts/retirer" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<button>💰 Retirer</button>
</form>`:''}
${req.session.user.permissions.print?
`<a href="/transferts/print/${t._id}" target="_blank"><button>🖨</button></a>`:''}
</td></tr>`;
  });

  html+=`</table></body></html>`;
  res.send(html);
});

/* ================= PRINT TICKET ================= */
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.send(`<html><body onload="window.print()" style="width:280px">
<h3>TRANSFERT</h3>
Code: ${t.code}<br>
Montant: ${t.amount} ${t.currency}<br>
Dest: ${t.receiverPhone}<br>
Statut: ${t.retired?'Retiré':'Non retiré'}
</body></html>`);
});

/* ================= PRINT BULK ================= */
app.get('/transferts/print-bulk', requireLogin, async(req,res)=>{
  let data = await Transfert.find();
  let html='<html><body onload="window.print()">';
  data.forEach(t=>{
    html+=`<div style="width:280px;border-bottom:1px dashed #000;margin-bottom:10px">
Code:${t.code}<br>
Montant:${t.amount} ${t.currency}<br>
Dest:${t.receiverPhone}
</div>`;
  });
  html+='</body></html>';
  res.send(html);
});

/* ================= START ================= */
app.listen(3000,()=>console.log('🚀 Serveur prêt http://localhost:3000'));
