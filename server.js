/******************************************************************
 * APP TRANSFERT – DASHBOARD ORANGE COMPLET + RETRAIT + GRAPH
 * Tous les champs inclus, fond rouge pour retraités
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
  input,select,button{padding:10px;margin:5px;width:90%;}
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
const userTypes = ['Client','Distributeur','Administrateur','Agence de transfert'];

app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t = await Transfert.findOne({code:req.query.code});
  const code = t? t.code : await generateUniqueCode();
  res.send(`<html>
  <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial;background:#fff3e0;padding:20px;}
    input,select,button{padding:10px;margin:5px;width:95%;}
    button{background:#ff5722;color:#fff;border:none;border-radius:6px;}
  </style></head>
  <body>
    <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
    <form method="post">
      <label>Type de personne</label>
      <select name="userType" required>${userTypes.map(u=>`<option ${t&&t.userType===u?'selected':''}>${u}</option>`).join('')}</select><br>
      <h3>Expéditeur</h3>
      <input name="senderFirstName" placeholder="Prénom" value="${t?t.senderFirstName:''}" required>
      <input name="senderLastName" placeholder="Nom" value="${t?t.senderLastName:''}" required>
      <input name="senderPhone" placeholder="Téléphone" value="${t?t.senderPhone:''}" required>
      <select name="originLocation">${locations.map(l=>`<option ${t&&t.originLocation===l?'selected':''}>${l}</option>`).join('')}</select><br>
      <h3>Destinataire</h3>
      <input name="receiverFirstName" placeholder="Prénom" value="${t?t.receiverFirstName:''}" required>
      <input name="receiverLastName" placeholder="Nom" value="${t?t.receiverLastName:''}" required>
      <input name="receiverPhone" placeholder="Téléphone" value="${t?t.receiverPhone:''}" required>
      <select name="destinationLocation">${locations.map(l=>`<option ${t&&t.destinationLocation===l?'selected':''}>${l}</option>`).join('')}</select><br>
      <h3>Montants & Devise</h3>
      <input type="number" id="amount" name="amount" placeholder="Montant" value="${t?t.amount:''}" required>
      <input type="number" id="fees" name="fees" placeholder="Frais" value="${t?t.fees:''}" required>
      <input type="text" id="recoveryAmount" readonly placeholder="Montant à recevoir" value="${t?t.recoveryAmount:''}">
      <select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select><br>
      <label>Code transfert</label>
      <input name="code" readonly value="${code}"><br>
      <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
    </form>
    <a href="/menu">⬅ Retour menu</a>
    <script>
      const amountField=document.getElementById('amount');
      const feesField=document.getElementById('fees');
      const recoveryField=document.getElementById('recoveryAmount');
      function updateRecovery(){recoveryField.value=(parseFloat(amountField.value||0)-parseFloat(feesField.value||0)).toFixed(2);}
      amountField.addEventListener('input',updateRecovery);
      feesField.addEventListener('input',updateRecovery);
      updateRecovery();
    </script>
  </body></html>`);
});

app.post('/transferts/form', requireLogin, async(req,res)=>{
  const data = req.body;
  data.amount = Number(data.amount||0);
  data.fees = Number(data.fees||0);
  data.recoveryAmount = data.amount - data.fees;
  let existing = await Transfert.findOne({ code:data.code });
  if(existing){
    await Transfert.findByIdAndUpdate(existing._id,data);
  }else{
    data.retraitHistory=[];
    await new Transfert(data).save();
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
    .retired{background:#ff4d4d;color:white;}
    .destination{font-weight:bold;font-size:18px;margin-top:15px;}
    .chart{width:100%;max-width:400px;height:200px;margin:30px auto;}
  </style></head>
  <body>
  <h2>Liste des transferts</h2>
  <a href="/menu">⬅ Menu</a> | <a href="/transferts/form">➕ Nouveau</a><hr>`;

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
      <strong>Type:</strong> ${t.userType} | 
      <strong>Expéditeur:</strong> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | 
      <strong>Origine:</strong> ${t.originLocation} | 
      <strong>Montant:</strong> ${t.amount} ${t.currency} | 
      <strong>Frais:</strong> ${t.fees} | 
      <strong>Reçu:</strong> ${t.recoveryAmount} | 
      <strong>Destinataire:</strong> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | 
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
    <p>Type: ${t.userType}</p>
    <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
    <p>Origine: ${t.originLocation}</p>
    <p>Montant: ${t.amount} ${t.currency}</p>
    <p>Frais: ${t.fees}</p>
    <p>À recevoir: ${t.recoveryAmount}</p>
    <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
    <p>Destination: ${t.destinationLocation}</p>
    <p>Status: ${t.retired?'Retiré':'Non retiré'}</p>
    <button onclick="window.print()">🖨️ Imprimer</button>
  </body></html>`);
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ================= SERVEUR =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur en écoute sur le port ${PORT}`));
