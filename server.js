/******************************************************************
 * APP TRANSFERT + STOCKS – VERSION CORRIGÉE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret-final', resave: false, saveUninitialized: true }));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌ Erreur MongoDB:', err.message); process.exit(1); });

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ['Client', 'Distributeur', 'Administrateur', 'Agence de transfert'], required: true },
  senderFirstName: String, senderLastName: String, senderPhone: String, originLocation: String,
  receiverFirstName: String, receiverLastName: String, receiverPhone: String, destinationLocation: String,
  amount: Number, fees: Number, recoveryAmount: Number, currency: { type: String, enum: ['GNF', 'EUR', 'USD', 'XOF'], default: 'GNF' },
  recoveryMode: String, retraitHistory: [{ date: Date, mode: String }], retired: { type: Boolean, default: false },
  code: { type: String, unique: true }, createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username: String, password: String, role: { type: String, enum: ['admin', 'agent'], default: 'agent' } });
const Auth = mongoose.model('Auth', authSchema);

const stockSchema = new mongoose.Schema({
  code: { type: String, unique: true }, action: String, sender: String, destination: String, amount: Number, currency: { type: String, default: 'GNF' }, createdAt: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code: { type: String, unique: true }, action: String, stockId: mongoose.Schema.Types.ObjectId, sender: String, destination: String, amount: Number, currency: String, date: { type: Date, default: Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

// ================= UTILS =================
async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const number = Math.floor(100 + Math.random() * 900);
    code = `${letter}${number}`;
    exists = await Transfert.findOne({ code }) || await Stock.findOne({ code });
  }
  return code;
}

const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

function setPermissions(username) {
  if (username === 'a') return { lecture: true, ecriture: false, retrait: true, modification: false, suppression: false, imprimer: true };
  if (username === 'admin2') return { lecture: true, ecriture: true, retrait: false, modification: true, suppression: true, imprimer: true };
  return { lecture: true, ecriture: true, retrait: true, modification: true, suppression: true, imprimer: true };
}

const locations = ['France', 'Belgique', 'Conakry', 'Suisse', 'Atlanta', 'New York', 'Allemagne'];
const currencies = ['GNF', 'EUR', 'USD', 'XOF'];
const retraitModes = ['Espèces', 'Virement', 'Orange Money', 'Wave'];

// ================= LOGIN =================
app.get('/login', (req, res) => {
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh;}
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
    </div>
  </body></html>`);
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  let user = await Auth.findOne({ username });
  if (!user) { const hashed = bcrypt.hashSync(password, 10); user = await new Auth({ username, password: hashed }).save(); }
  if (!bcrypt.compareSync(password, user.password)) return res.send('Mot de passe incorrect');
  req.session.user = { username: user.username, role: user.role, permissions: setPermissions(username) };
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

// ================= DASHBOARD =================
app.get('/dashboard', requireLogin, async (req, res) => {
  const { search = '', status = 'all' } = req.query;
  const transfertsRaw = await Transfert.find().sort({ createdAt: -1 });
  const stocks = await Stock.find().sort({ createdAt: -1 });
  const stockHistory = await StockHistory.find().sort({ date: -1 });

  const s = search.toLowerCase();
  let transferts = transfertsRaw.filter(t => {
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if (status === 'retire') transferts = transferts.filter(t => t.retired);
  else if (status === 'non') transferts = transferts.filter(t => !t.retired);

  const totals = {};
  transferts.forEach(t => {
    if (!totals[t.destinationLocation]) totals[t.destinationLocation] = {};
    if (!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency] = { amount: 0, fees: 0, recovery: 0 };
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  let html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
  body{font-family:Arial;background:#f0f2f5;margin:0;padding:20px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:8px;text-align:left;}
  th{background:#ff8c42;color:white;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;margin-right:3px;font-size:12px;}
  .modify{background:#28a745;} .delete{background:#dc3545;} .retirer{background:#ff9900;}
  a{color:#007bff;text-decoration:none;margin-right:10px;}
  a:hover{text-decoration:underline;}
  input,select{padding:5px;margin-right:5px;}
  </style></head><body>
  <h2>📊 Dashboard</h2>
  <a href="/logout">🚪 Déconnexion</a>

  <h3>Transferts</h3>
  <form method="get" action="/dashboard">
    <input type="text" name="search" placeholder="Recherche..." value="${search}">
    <select name="status">
      <option value="all" ${status === 'all' ? 'selected' : ''}>Tous</option>
      <option value="retire" ${status === 'retire' ? 'selected' : ''}>Retirés</option>
      <option value="non" ${status === 'non' ? 'selected' : ''}>Non retirés</option>
    </select>
    <button type="submit">🔍 Filtrer</button>
    ${req.session.user.permissions.ecriture ? '<button type="button" onclick="newTransfert()">➕ Nouveau Transfert</button>' : ''}
  </form>
  <h4>Totaux par destination/devise</h4>
  <table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;

  for (let dest in totals) {
    for (let curr in totals[dest]) {
      html += `<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }

  html += `</tbody></table><table><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th></tr>`;

  transferts.forEach(t => {
    html += `<tr data-id="${t._id}"><td>${t.code}</td><td>${t.senderFirstName}</td><td>${t.receiverFirstName}</td><td>${t.amount}</td><td>${t.currency}</td><td>${t.retired ? 'Retiré' : 'Non retiré'}</td>
    <td>
      <button class="modify" onclick="editTransfert('${t._id}')">✏️</button>
      <button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
      ${!t.retired ? `<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>` : ''}
    </td></tr>`;
  });

  html += `</table><h3>Stocks</h3>
    ${req.session.user.permissions.ecriture ? '<button type="button" onclick="newStock()">➕ Nouveau Stock</button>' : ''}
    <table><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;

  stocks.forEach(s => {
    html += `<tr data-id="${s._id}"><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td>
      <td><button onclick="editStock('${s._id}')">✏️</button><button onclick="deleteStock('${s._id}')">❌</button></td></tr>`;
  });

  html += `</table><h3>Historique Stocks</h3><table><tr><th>Date</th><th>Code</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>`;
  stockHistory.forEach(h => {
    html += `<tr><td>${h.date.toLocaleString()}</td><td>${h.code}</td><td>${h.action}</td><td>${h.sender}</td><td>${h.destination}</td><td>${h.amount}</td>
 <td><button onclick="editStock('${s._id}')">✏️</button><button onclick="deleteStock('${s._id}')">❌</button></td></tr></tr>`;
  });
  html += `</table>`;

  html += `<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}

  function newTransfert(){
    const sender = prompt('Expéditeur'); const receiver = prompt('Destinataire');
    const amount = parseFloat(prompt('Montant')); const currency = prompt('Devise','GNF');
    if(sender && receiver && amount) postData('/transferts/form',{senderFirstName:sender,receiverFirstName:receiver,amount,fees:0,recoveryAmount:amount,currency,userType:'Client'}).then(()=>location.reload());
  }

  function newStock(){
    const sender = prompt('Expéditeur'); const destination = prompt('Destination');
    const amount = parseFloat(prompt('Montant')); const currency = prompt('Devise','GNF');
    if(sender && destination && amount) postData('/stocks/new',{sender,destination,amount,currency}).then(()=>location.reload());
  }

  async function editTransfert(id){
    const t = await (await fetch('/transferts/get/'+id)).json();
    const sender = prompt('Expéditeur', t.senderFirstName) || t.senderFirstName;
    const receiver = prompt('Destinataire', t.receiverFirstName) || t.receiverFirstName;
    const amount = parseFloat(prompt('Montant', t.amount)) || t.amount;
    const currency = prompt('Devise', t.currency) || t.currency;
    await postData('/transferts/form',{_id:t._id, senderFirstName:sender, receiverFirstName:receiver, amount, currency});
    location.reload();
  }
  async function deleteTransfert(id){if(confirm('Supprimer ce transfert ?')){await postData('/transferts/delete',{id}); location.reload();}}
  async function retirerTransfert(id){const mode=prompt('Mode de retrait','Espèces'); if(mode){await postData('/transferts/retirer',{id,mode}); location.reload();}}

  async function editStock(id){
    const s = await (await fetch('/stocks/get/'+id)).json();
    const sender = prompt('Expéditeur', s.sender) || s.sender;
    const destination = prompt('Destination', s.destination) || s.destination;
    const amount = parseFloat(prompt('Montant', s.amount)) || s.amount;
    const currency = prompt('Devise', s.currency) || s.currency;
    await postData('/stocks/new', {_id: s._id, sender, destination, amount, currency});
    location.reload();
  }
  async function deleteStock(id){if(confirm('Supprimer ce stock ?')){await postData('/stocks/delete',{id}); location.reload();}}
  </script>`;

  html += '</body></html>';
  res.send(html);
});

// ================= TRANSFERT ROUTES =================
app.post('/transferts/form', requireLogin, async (req, res) => {
  const data = req.body;
  if (data._id) {
    await Transfert.findByIdAndUpdate(data._id, { ...data });
  } else {
    const code = data.code || await generateUniqueCode();
    await new Transfert({ ...data, code, retraitHistory: [] }).save();
  }
  res.json({ ok: true });
});

app.post('/transferts/delete', requireLogin, async (req, res) => {
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});

app.post('/transferts/retirer', requireLogin, async (req, res) => {
  const { id, mode } = req.body;
  await Transfert.findByIdAndUpdate(id, { retired: true, $push: { retraitHistory: { date: new Date(), mode } } });
  res.json({ ok: true });
});

app.get('/transferts/get/:id', requireLogin, async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  res.json(t);
});

// ================= STOCK ROUTES =================
app.post('/stocks/new', requireLogin, async (req, res) => {
  const data = req.body;
  if (data._id) {
    await Stock.findByIdAndUpdate(data._id, { ...data });
  } else {
    const code = data.code || await generateUniqueCode();
    await new StockHistory({ ...data, code }).save();
  }
  res.json({ ok: true });
});

app.post('/stocks/delete', requireLogin, async (req, res) => {
  const s = await Stock.findByIdAndDelete(req.body.id);
  if (s) {
    await new Stock({
      action: 'Suppression',
      stockId: s._id,
      sender: s.sender,
      destination: s.destination,
      amount: s.amount,
      currency: s.currency
    }).save();
  }
  res.json({ ok: true });
});

app.get('/stocks/get/:id', requireLogin, async (req, res) => {
  const s = await Stock.findById(req.params.id);
  res.json(s);
});

// ================= SERVER =================
app.listen(process.env.PORT || 3000, () => console.log('🚀 Serveur lancé sur http://localhost:3000'));
