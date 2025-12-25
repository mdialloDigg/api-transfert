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
  secret: 'secret-transfert',
  resave: false,
  saveUninitialized: false
}));

/* ================= DB ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté'))
.catch(err=>console.error(err));

/* ================= MODELS ================= */
const Transfert = mongoose.model('Transfert', new mongoose.Schema({
  code:String,
  senderFirstName:String,
  receiverFirstName:String,
  destination:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  retired:{type:Boolean,default:false},
  history:[{date:Date,mode:String}],
  createdAt:{type:Date,default:Date.now}
}));

const Auth = mongoose.model('Auth', new mongoose.Schema({
  username:String,
  password:String,
  role:String
}));

/* ================= UTILS ================= */
const auth = (req,res,next)=>{
  if(req.session.user) next();
  else res.redirect('/login');
};

/* ================= LOGIN ================= */
app.get('/login',(req,res)=>{
res.send(`
<h3>Connexion</h3>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
`);
});

app.post('/login', async(req,res)=>{
  let user = await Auth.findOne({username:req.body.username});
  if(!user){
    user = await new Auth({
      username:req.body.username,
      password:bcrypt.hashSync(req.body.password,10),
      role:'admin'
    }).save();
  }
  if(!bcrypt.compareSync(req.body.password,user.password))
    return res.send('Mot de passe incorrect');

  req.session.user=user;
  res.redirect('/transferts/list');
});

/* ================= FORM ================= */
app.get('/transferts/form', auth, (req,res)=>{
res.send(`
<h3>Nouveau Transfert</h3>
<form method="post">
<input name="code" placeholder="Code" required><br><br>
<input name="senderFirstName" placeholder="Expéditeur"><br><br>
<input name="receiverFirstName" placeholder="Destinataire"><br><br>
<input name="destination" placeholder="Destination"><br><br>
<input name="amount" id="amount" placeholder="Montant"><br><br>
<input name="fees" id="fees" placeholder="Frais"><br><br>
<input id="rec" placeholder="À recevoir" readonly><br><br>
<button>Enregistrer</button>
</form>

<script>
amount.oninput = fees.oninput = () =>
rec.value = (amount.value||0)-(fees.value||0);
</script>
`);
});

app.post('/transferts/form', auth, async(req,res)=>{
  const {code,senderFirstName,receiverFirstName,destination,amount,fees} = req.body;
  const recoveryAmount = amount-fees;

  await new Transfert({
    code,
    senderFirstName,
    receiverFirstName,
    destination,
    amount,
    fees,
    recoveryAmount
  }).save();

  res.redirect('/transferts/list?search='+code);
});

/* ================= LIST ================= */
app.get('/transferts/list', auth, async(req,res)=>{
  const search = (req.query.search||'').toLowerCase();
  let list = await Transfert.find().sort({createdAt:-1});

  if(search){
    list = list.filter(t =>
      Object.values(t.toObject()).join(' ').toLowerCase().includes(search)
    );
  }

res.send(`
<h3>Liste des Transferts</h3>

<form>
<input name="search" value="${req.query.search||''}" placeholder="Recherche globale">
<button>Rechercher</button>
</form>

<br>
<a href="/transferts/form">➕ Nouveau</a> |
<a href="/transferts/pdf">📄 PDF</a> |
<a href="/transferts/excel">📊 Excel</a> |
<a href="/logout">🚪 Déconnexion</a>

<table border="1" cellpadding="5" cellspacing="0">
<tr>
<th>Code</th><th>Expéditeur</th><th>Destinataire</th>
<th>Destination</th><th>Montant</th><th>Statut</th><th>Action</th>
</tr>

${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.senderFirstName}</td>
<td>${t.receiverFirstName}</td>
<td>${t.destination}</td>
<td>${t.amount}</td>
<td>${t.retired?'Retiré':'Non'}</td>
<td>
${!t.retired ? `<button onclick="retirer('${t._id}')">Retirer</button>`:''}
<a href="/transferts/delete/${t._id}">❌</a>
</td>
</tr>
`).join('')}
</table>

<script>
function retirer(id){
fetch('/transferts/retirer',{
method:'POST',
headers:{'Content-Type':'application/x-www-form-urlencoded'},
body:'id='+id
}).then(()=>location.reload());
}
</script>
`);
});

/* ================= RETIRER ================= */
app.post('/transferts/retirer', auth, async(req,res)=>{
  await Transfert.updateOne(
    {_id:req.body.id},
    {$set:{retired:true},$push:{history:{date:new Date(),mode:'Espèces'}}}
  );
  res.sendStatus(200);
});

/* ================= DELETE ================= */
app.get('/transferts/delete/:id', auth, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

/* ================= PDF ================= */
app.get('/transferts/pdf', auth, async(req,res)=>{
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  doc.pipe(res);
  (await Transfert.find()).forEach(t=>{
    doc.text(`${t.code} - ${t.senderFirstName} → ${t.receiverFirstName} : ${t.amount}`);
  });
  doc.end();
});

/* ================= EXCEL ================= */
app.get('/transferts/excel', auth, async(req,res)=>{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transferts');
  ws.addRow(['Code','Expéditeur','Destinataire','Destination','Montant','Statut']);
  (await Transfert.find()).forEach(t=>{
    ws.addRow([t.code,t.senderFirstName,t.receiverFirstName,t.destination,t.amount,t.retired?'Retiré':'Non']);
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

/* ================= LOGOUT ================= */
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= START ================= */
app.listen(process.env.PORT||3000,()=>{
  console.log('🚀 Serveur prêt');
});
