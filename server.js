/******************************************************************
 * APP TRANSFERT – DASHBOARD COMPLET AVEC AJAX, EXPORT ET MOBILE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

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
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String, role:{type:String, enum:['admin','agent'], default:'agent'} });
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
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
  form{background:#fff;padding:30px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.2);display:inline-block;}
  input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}
  button{background:#007bff;color:white;border:none;font-weight:bold;cursor:pointer;transition:0.3s;}
  button:hover{background:#0056b3;}
  </style></head><body>
  <h2>Connexion</h2>
  <form method="post">
  <input name="username" placeholder="Utilisateur" required><br>
  <input type="password" name="password" placeholder="Mot de passe" required><br>
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

// ================= SERVE STATIC =================
app.use('/static', express.static('public'));

// ================= ROUTES AJAX =================
app.get('/transferts/data', requireLogin, async(req,res)=>{
  let { search='', status='all', currency='', destination='' } = req.query;
  let transferts = await Transfert.find().sort({createdAt:-1});

  search = search.toLowerCase();
  transferts = transferts.filter(t=>{
    return t.code.toLowerCase().includes(search)
      || t.senderFirstName.toLowerCase().includes(search)
      || t.senderLastName.toLowerCase().includes(search)
      || t.senderPhone.toLowerCase().includes(search)
      || t.receiverFirstName.toLowerCase().includes(search)
      || t.receiverLastName.toLowerCase().includes(search)
      || t.receiverPhone.toLowerCase().includes(search);
  });

  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);
  if(currency) transferts = transferts.filter(t=>t.currency===currency);
  if(destination) transferts = transferts.filter(t=>t.destinationLocation===destination);

  res.json(transferts);
});

// ================= CRUD TRANSFERT =================
app.get('/transferts/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.json(t);
});

app.post('/transferts', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = await generateUniqueCode();
  await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
  res.sendStatus(200);
});

app.put('/transferts/:id', requireLogin, async(req,res)=>{
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  await Transfert.findByIdAndUpdate(req.params.id,{...req.body, amount, fees, recoveryAmount});
  res.sendStatus(200);
});

app.delete('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.sendStatus(200);
});

app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndUpdate(req.body.id,{
    retired:true,
    recoveryMode:req.body.mode,
    $push:{ retraitHistory:{ date:new Date(), mode:req.body.mode } }
  });
  res.sendStatus(200);
});

// ================= PRINT =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;text-align:center;padding:10px;}
  .ticket{border:1px dashed #333;padding:10px;width:280px;margin:auto;}
  h3{margin:5px 0;}p{margin:3px 0;font-size:14px;}
  button{margin-top:5px;padding:5px 10px;}
  </style></head><body>
  <div class="ticket">
  <h3>💰 Transfert</h3>
  <p>Code: ${t.code}</p>
  <p>Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
  <p>Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
  <p>Montant: ${t.amount} ${t.currency}</p>
  <p>Frais: ${t.fees}</p>
  <p>Reçu: ${t.recoveryAmount}</p>
  <p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
  </div>
  <button onclick="window.print()">🖨 Imprimer</button>
  </body></html>`);
});

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code', key:'code'}, {header:'Type', key:'userType'},
    {header:'Expéditeur', key:'sender'}, {header:'Origine', key:'origin'},
    {header:'Destinataire', key:'receiver'}, {header:'Montant', key:'amount'},
    {header:'Frais', key:'fees'}, {header:'Reçu', key:'recovery'}, {header:'Devise', key:'currency'}, {header:'Statut', key:'status'}
  ];
  transferts.forEach(t=>{
    sheet.addRow({
      code:t.code, userType:t.userType,
      sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`, origin:t.originLocation,
      receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
      amount:t.amount, fees:t.fees, recovery:t.recoveryAmount, currency:t.currency, status:t.retired?'Retiré':'Non retiré'
    });
  });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({createdAt:-1});
  const doc = new Document();
  transferts.forEach(t=>{
    doc.addSection({children:[
      new Paragraph({children:[new TextRun({text:`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Statut: ${t.retired?'Retiré':'Non retiré'}`})]})
    ]});
  });
  const packer = new Packer();
  const buffer = await packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename=transferts.docx');
  res.send(buffer);
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`));
