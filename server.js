/******************************************************************
 * APP TRANSFERT – DASHBOARD ORANGE COMPLET + RETRAIT + GRAPH
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
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
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
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

const requireLogin = (req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= REDIRECTION ROOT =================
app.get('/', (req,res)=> res.redirect('/menu'));

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;background:#fff3e0;padding:30px;text-align:center;}
  input,button{padding:10px;margin:5px;}
  button{background:#ff5722;color:#fff;border:none;border-radius:6px;}
  </style></head>
  <body>
    <h2>Connexion</h2>
    <form method="post">
      <input name="username" placeholder="Utilisateur" required><br>
      <input type="password" name="password" placeholder="Mot de passe" required><br>
      <button>Connexion</button>
    </form>
  </body></html>`);
});

app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  let user = await Auth.findOne({ username }).exec();
  if(!user){
    const hashed = bcrypt.hashSync(password,10);
    await new Auth({ username, password: hashed }).save();
    req.session.user = username;
    return res.redirect('/menu');
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user = username;
  res.redirect('/menu');
});

// ================= MENU =================
app.get('/menu', requireLogin,(req,res)=>{
  res.send(`<html>
  <body style="font-family:Arial;background:#fff3e0;text-align:center;padding:30px;">
    <h2>📲 Gestion des transferts</h2>
    <a href="/transferts/form"><button style="padding:10px;margin:5px;background:#ff5722;color:#fff;">➕ Envoyer de l'argent</button></a><br>
    <a href="/transferts/list"><button style="padding:10px;margin:5px;background:#ff5722;color:#fff;">📋 Liste / Historique</button></a><br>
    <a href="/logout"><button style="padding:10px;margin:5px;background:#dc3545;color:#fff;">🚪 Déconnexion</button></a>
  </body></html>`);
});

// ================= FORMULAIRE =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['GNF','EUR','USD','XOF'];

app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(`<html>
  <body style="font-family:Arial;background:#fff3e0;padding:30px;">
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <label>Prénom Expéditeur</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"><br>
      <label>Nom Expéditeur</label><input name="senderLastName" required value="${t?t.senderLastName:''}"><br>
      <label>Montant</label><input type="number" name="amount" required value="${t?t.amount:''}"><br>
      <label>Code transfert</label><input name="code" readonly value="${code}"><br>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/menu">⬅ Retour menu</a>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const { senderFirstName, senderLastName, amount, code } = req.body;
  let existing = await Transfert.findOne({ code });
  if(existing){
    await Transfert.findByIdAndUpdate(existing._id,{ senderFirstName, senderLastName, amount, recoveryAmount:amount });
  }else{
    await new Transfert({ senderFirstName, senderLastName, amount, fees:0, recoveryAmount:amount, code, retraitHistory: [] }).save();
  }
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const transferts = await Transfert.find().sort({destinationLocation:1, retired:1, createdAt:-1});
  let html = `<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;background:#fff3e0;padding:20px;}
    .card{padding:10px;margin:5px;border-radius:6px;}
    .nonRetired{background:#ffe0b2;}
    .retired{background:#ffcdd2;}
    .destination{font-weight:bold;font-size:18px;margin-top:15px;}
    .chart{width:100%;max-width:400px;height:200px;margin:30px auto;}
  </style></head>
  <body>
  <h2>Liste des transferts</h2>
  <a href="/menu">⬅ Menu</a> | <a href="/transferts/form">➕ Nouveau</a><hr>`;

  // Group by destination
  const grouped = {};
  transferts.forEach(t=>{
    if(!grouped[t.destinationLocation]) grouped[t.destinationLocation]=[];
    grouped[t.destinationLocation].push(t);
  });

  const chartData = [];

  for(const dest in grouped){
    html += `<div class="destination">Destination: ${dest}</div>`;
    let total = 0;
    grouped[dest].forEach(t=>{
      total += t.recoveryAmount;
      html+=`<div class="card ${t.retired?'retired':'nonRetired'}">
      <strong>Code:</strong> ${t.code} | 
      <strong>Expéditeur:</strong> ${t.senderFirstName} ${t.senderLastName} | 
      <strong>Montant:</strong> ${t.amount} 
      <a href="/transferts/form?code=${t.code}">✏️ Modifier</a> | 
      <a href="/transferts/delete/${t._id}" onclick="return confirm('Confirmer suppression ?')">❌ Supprimer</a> | 
      <a href="/transferts/print/${t._id}" target="_blank">🖨️ Imprimer</a><br>
      Status: ${t.retired?'Retiré':'Non retiré'}`;

      if(!t.retired){
        html+=`<form method="post" action="/transferts/retirer">
          <input type="hidden" name="id" value="${t._id}">
          <select name="mode">
            <option>Espèces</option>
            <option>Orange Money</option>
            <option>Wave</option>
            <option>Produit</option>
            <option>Service</option>
          </select>
          <button>Retirer</button>
        </form>`;
      }

      if(t.retraitHistory && t.retraitHistory.length){
        html+='<br>Historique Retraits:<br>';
        t.retraitHistory.forEach(h=>{
          html+=`${new Date(h.date).toLocaleString()} (${h.mode})<br>`;
        });
      }

      html+='</div>';
    });
    chartData.push({ destination: dest, total });
  }

  // Mini chart at the bottom
  html+=`<canvas id="chart" class="chart"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    new Chart(ctx,{
      type:'bar',
      data:{
        labels:[${chartData.map(c=>`"${c.destination}"`).join(',')}],
        datasets:[{label:'Total par destination', data:[${chartData.map(c=>c.total)}], backgroundColor:'#ff9800'}]
      },
      options:{responsive:true,plugins:{legend:{display:false}}}
    });
  </script>`;

  html+='</body></html>';
  res.send(html);
});

// ================= RETRAIT =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  const { id, mode } = req.body;
  await Transfert.findByIdAndUpdate(id,{
    retired:true,
    recoveryMode:mode,
    $push:{ retraitHistory:{ date:new Date(), mode } }
  });
  res.redirect('/transferts/list');
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= IMPRIMER =================
app.get('/transferts/print/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send('Transfert introuvable');
  res.send(`<html>
  <body style="font-family:Arial;text-align:center;padding:20px;background:#fff3e0;">
    <h2>💰 Transfert</h2>
    <p>Code: ${t.code}</p>
    <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
    <p>Montant: ${t.amount}</p>
    <p>Status: ${t.retired?'Retiré':'Non retiré'}</p>
    <button onclick="window.print()">🖨️ Imprimer</button>
  </body></html>`);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
