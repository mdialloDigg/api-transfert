/******************************************************************
 * APP TRANSFERT – VERSION FINALE SECURISEE ET COMPLETE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const helmet = require('helmet');
const MongoStore = require('connect-mongo');

const app = express();

// ================= CONFIG =================
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('trust proxy', 1); // si derrière proxy
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 2 // 2h
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert',
    ttl: 2 * 60 * 60
  })
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
  senderFirstName: { type: String, required:true },
  senderLastName: { type: String, required:true },
  senderPhone: { type: String, required:true },
  originLocation: String,
  receiverFirstName: { type: String, required:true },
  receiverLastName: { type: String, required:true },
  receiverPhone: { type: String, required:true },
  destinationLocation: String,
  amount: { type: Number, required:true, min:0 },
  fees: { type: Number, required:true, min:0 },
  recoveryAmount: Number,
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({
  username: { type: String, unique:true, required:true },
  password: { type: String, required:true }
});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILITAIRE =================
async function generateUniqueCode() {
  let code;
  let exists = true;
  while(exists){
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }).exec();
  }
  return code;
}

// ================= AUTH MIDDLEWARE =================
const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOCATIONS =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{margin:0;font-family:Arial;background:#f0f4f8;text-align:center;padding-top:80px;}
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
  </form>
  </body></html>`);
});

app.post('/login', async (req,res)=>{
  try{
    const username = req.body.username?.trim();
    const password = req.body.password;
    if(!username || !password) return res.send('Informations manquantes');

    let user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = await bcrypt.hash(password,10);
      user = await new Auth({ username, password: hashed }).save();
      req.session.user = username;
      return res.redirect('/menu');
    }

    const match = await bcrypt.compare(password, user.password);
    if(!match) return res.send('Mot de passe incorrect');

    req.session.user = username;
    res.redirect('/menu');
  }catch(err){
    console.error('Erreur login:', err);
    res.status(500).send('Erreur serveur');
  }
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
  res.send(`
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#eef2f7;text-align:center;padding-top:50px;}
  button{width:280px;padding:15px;margin:12px;font-size:16px;border:none;border-radius:8px;color:white;cursor:pointer;transition:0.3s}
  .send{background:#007bff}.send:hover{background:#0056b3}
  .list{background:#28a745}.list:hover{background:#1e7e34}
  .logout{background:#dc3545}.logout:hover{background:#a71d2a}
  </style></head>
  <body>
  <h2>📲 Gestion des transferts</h2>
  <a href="/transferts/new"><button class="send">➕ Envoyer de l'argent</button></a><br>
  <a href="/transferts/list"><button class="list">📋 Liste / Historique</button></a><br>
  <a href="/logout"><button class="logout">🚪 Déconnexion</button></a>
  </body></html>
  `);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

// ================= TRANSFERTS – CREATION =================
app.get('/transferts/new', requireLogin, async(req,res)=>{
  const code = await generateUniqueCode();
  res.send(generateTransfertForm(code));
});

app.post('/transferts/new', requireLogin, async(req,res)=>{
  try{
    const amount = Number(req.body.amount || 0);
    const fees = Number(req.body.fees || 0);
    const recoveryAmount = amount - fees;
    const code = req.body.code || await generateUniqueCode();
    await new Transfert({
      ...req.body,
      amount,
      fees,
      recoveryAmount,
      retraitHistory: [],
      code
    }).save();
    res.redirect('/transferts/list');
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// ================= TRANSFERTS – EDIT =================
app.get('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(generateTransfertForm(t.code, t));
});

app.post('/transferts/edit/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  await Transfert.findByIdAndUpdate(req.params.id,{...req.body, amount, fees, recoveryAmount});
  res.redirect('/transferts/list');
});

// ================= TRANSFERTS – DELETE =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= TRANSFERTS – RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      recoveryMode:req.body.mode,
      $push: { retraitHistory: { date: new Date(), mode:req.body.mode } }
    });
    res.redirect('/transferts/list');
  }catch(err){
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// ================= TRANSFERTS – LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1});
  let grouped = {};
  transferts.forEach(t=>{ if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[]; grouped[t.destinationLocation].push(t); });

  let totalAmountAll=0,totalFeesAll=0,totalReceivedAll=0;
  let html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  table{width:95%;margin:auto;border-collapse:collapse;}
  th,td{border:1px solid #ccc;padding:8px;text-align:center;}
  th{background:#007bff;color:white;}
  button{padding:4px 8px;margin:2px;cursor:pointer;}
  button.delete{background:#dc3545;color:white;}
  button.print{background:#17a2b8;color:white;}
  a{margin:2px;text-decoration:none;}
  form{display:inline;}
  </style>
  <script>function confirmDelete(){return confirm('❌ Confirmer suppression?');}</script>
  </head><body>
  <h2>Liste des transferts</h2><a href="/menu">⬅ Menu</a> | <a href="/transferts/new">➕ Nouveau</a> | <a href="/transferts/pdf">📄 PDF</a><hr>`;
  
  for(let dest in grouped){
    let ta=0,tf=0,tr=0;
    html+=`<h3>Destination: ${dest}</h3><table>
<tr><th>Type</th><th>Expéditeur</th><th>Tél</th><th>Origine</th>
<th>Montant</th><th>Frais</th><th>Reçu</th><th>Destinataire</th><th>Tél</th>
<th>Code</th><th>Statut</th><th>Actions</th></tr>`;
    grouped[dest].forEach(t=>{
      ta+=t.amount; tf+=t.fees; tr+=t.recoveryAmount;
      totalAmountAll+=t.amount; totalFeesAll+=t.fees; totalReceivedAll+=t.recoveryAmount;
      let histHtml = t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>') || '-';
      html+=`<tr class="${t.retired?'retired':''}">
<td>${t.userType}</td>
<td>${t.senderFirstName} ${t.senderLastName}</td>
<td>${t.senderPhone}</td>
<td>${t.originLocation}</td>
<td>${t.amount}</td>
<td>${t.fees}</td>
<td>${t.recoveryAmount}</td>
<td>${t.receiverFirstName} ${t.receiverLastName}</td>
<td>${t.receiverPhone}</td>
<td>${t.code}</td>
<td>${t.retired?'Retiré':'Non retiré'}<br>${histHtml}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirmDelete();"><button class="delete">❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️ Imprimer</button></a>
${t.retired?'':`<form method="post" action="/transferts/retirer">
<input type="hidden" name="id" value="${t._id}">
<select name="mode">
<option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option>
</select>
<button>Retirer</button></form>`}
</td></tr>`;
    });
    html+=`<tr style="font-weight:bold;"><td colspan="4">Total ${dest}</td><td>${ta}</td><td>${tf}</td><td>${tr}</td><td colspan="5"></td></tr></table>`;
  }
  html+=`<h3>Total global</h3><table style="width:50%;margin:auto;"><tr style="font-weight:bold;"><td>Total Montant</td><td>${totalAmountAll}</td></tr>
<tr style="font-weight:bold;"><td>Total Frais</td><td>${totalFeesAll}</td></tr>
<tr style="font-weight:bold;"><td>Total Reçu</td><td>${totalReceivedAll}</td></tr></table></body></html>`;
  res.send(html);
});

// ================= TRANSFERTS – PRINT =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html><body>
<div class="ticket">
<h3>💰 Transfert</h3>
<p>Code: ${t.code}</p>
<p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
<p>Tél: ${t.senderPhone}</p>
<p>Origine: ${t.originLocation}</p>
<p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
<p>Tél: ${t.receiverPhone}</p>
<p>Destination: ${t.destinationLocation}</p>
<p>Montant: ${t.amount}</p>
<p>Frais: ${t.fees}</p>
<p>À recevoir: ${t.recoveryAmount}</p>
<p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
<button onclick="window.print()">🖨️ Imprimer</button>
</div>
</body></html>`);
});

// ================= TRANSFERTS – PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  try{
    const list = await Transfert.find().sort({destinationLocation:1});
    const doc = new PDFDocument({margin:30, size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
    doc.pipe(res);

    doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'});
    doc.moveDown();

    let groupedPDF = {};
    list.forEach(t=>{ if(!groupedPDF[t.destinationLocation]) groupedPDF[t.destinationLocation]=[]; groupedPDF[t.destinationLocation].push(t); });

    let totalA=0,totalF=0,totalR=0;

    for(let dest in groupedPDF){
      let subA=0,subF=0,subR=0;
      doc.fontSize(14).fillColor('#007bff').text(`Destination: ${dest}`);
      groupedPDF[dest].forEach(t=>{
        subA+=t.amount; subF+=t.fees; subR+=t.recoveryAmount;
        totalA+=t.amount; totalF+=t.fees; totalR+=t.recoveryAmount;
        doc.fontSize(10).fillColor('black')
        .text(`Type: ${t.userType} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
        .text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Destination: ${t.destinationLocation}`)
        .text(`Montant: ${t.amount} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Statut: ${t.retired?'Retiré':'Non retiré'} | Code: ${t.code}`);
        if(t.retraitHistory && t.retraitHistory.length){
          t.retraitHistory.forEach(h=>{
            doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`);
          });
        }
        doc.moveDown(0.5);
      });
      doc.fontSize(12).text(`Sous-total ${dest} → Montant: ${subA} | Frais: ${subF} | Reçu: ${subR}`).moveDown();
    }
    doc.fontSize(14).fillColor('black').text(`TOTAL GLOBAL → Montant: ${totalA} | Frais: ${totalF} | Reçu: ${totalR}`,{align:'center'});
    doc.end();
  }catch(err){ console.error(err); res.status(500).send('Erreur serveur');}
});

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));

// ================= FONCTIONS UTILITAIRES =================
function generateTransfertForm(code, t=null){
  return `
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
  .container{max-width:900px;margin:40px auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
  h2{color:#2c7be5;text-align:center;margin-bottom:30px;}
  .grid{display:grid;grid
