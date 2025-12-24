/******************************************************************
 * APP TRANSFERT – VERSION FINALE COMPLETE ET STABLE
 ******************************************************************/

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

// ================= CONFIG =================
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
.catch(err=>console.error(err));

// ================= CONSTANTES =================
const locations = ['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies = ['EUR','USD','GBP','XOF','GNF','CHF'];

// ================= SCHEMAS =================
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

  currency:{ type:String, default:'EUR' },
  amount:Number,
  fees:Number,
  recoveryAmount:Number,

  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },

  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({ username:String, password:String });
const Auth = mongoose.model('Auth', authSchema);

// ================= UTILS =================
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    code = String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);
    exists = await Transfert.findOne({ code });
  }
  return code;
}

const requireLogin=(req,res,next)=>{
  if(req.session.user) return next();
  res.redirect('/login');
};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
res.send(`
<h2>Connexion</h2>
<form method="post">
<input name="username" placeholder="Utilisateur" required><br>
<input type="password" name="password" placeholder="Mot de passe" required><br>
<button>Connexion</button>
</form>
`);
});

app.post('/login', async(req,res)=>{
  const { username,password } = req.body;
  let user = await Auth.findOne({ username });
  if(!user){
    user = await new Auth({ username, password:bcrypt.hashSync(password,10) }).save();
  }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user=username;
  res.redirect('/menu');
});

// ================= MENU =================
app.get('/menu',requireLogin,(req,res)=>{
res.send(`
<h2>Menu</h2>
<a href="/transferts/phone"><button>➕ Envoyer de l'argent</button></a><br><br>
<a href="/transferts/list"><button>📋 Liste</button></a><br><br>
<a href="/logout"><button>🚪 Déconnexion</button></a>
`);
});

// ================= ETAPE TELEPHONE =================
app.get('/transferts/phone',requireLogin,(req,res)=>{
res.send(`
<h2>Numéro de téléphone</h2>
<form method="get" action="/transferts/new">
<input name="phone" placeholder="Téléphone expéditeur" required>
<button>Continuer</button>
</form>
`);
});

// ================= NOUVEAU TRANSFERT =================
app.get('/transferts/new',requireLogin, async(req,res)=>{
const code = await generateUniqueCode();
res.send(`
<h2>Nouveau transfert</h2>
<form method="post">
<input name="senderPhone" value="${req.query.phone||''}" required><br>

<select name="currency">
${currencies.map(c=>`<option>${c}</option>`).join('')}
</select><br>

<input name="senderFirstName" placeholder="Prénom expéditeur" required><br>
<input name="senderLastName" placeholder="Nom expéditeur" required><br>

<select name="originLocation">${locations.map(l=>`<option>${l}</option>`)}</select><br>

<input name="receiverFirstName" placeholder="Prénom destinataire" required><br>
<input name="receiverLastName" placeholder="Nom destinataire" required><br>
<input name="receiverPhone" placeholder="Téléphone destinataire" required><br>

<select name="destinationLocation">${locations.map(l=>`<option>${l}</option>`)}</select><br>

<input type="number" name="amount" placeholder="Montant" required><br>
<input type="number" name="fees" placeholder="Frais" required><br>

<input name="code" value="${code}" readonly><br>
<button>Enregistrer</button>
</form>
`);
});

app.post('/transferts/new',requireLogin, async(req,res)=>{
  const amount=+req.body.amount, fees=+req.body.fees;
  await new Transfert({
    ...req.body,
    amount,
    fees,
    recoveryAmount:amount-fees
  }).save();
  res.redirect('/transferts/list');
});

// ================= LISTE =================
app.get('/transferts/list',requireLogin, async(req,res)=>{
const list = await Transfert.find().sort({createdAt:-1});
res.send(`
<h2>Liste transferts</h2>
<table border="1">
<tr>
<th>Code</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Actions</th>
</tr>
${list.map(t=>`
<tr>
<td>${t.code}</td>
<td>${t.amount}</td>
<td>${t.currency}</td>
<td>${t.retired?'Retiré':'Actif'}</td>
<td>
<a href="/transferts/edit/${t._id}"><button>✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')"><button>❌ Supprimer</button></a>
<a href="/transferts/print/${t._id}"><button>🖨️ Ticket</button></a>
</td>
</tr>`).join('')}
</table>
<a href="/transferts/pdf">📄 PDF</a>
`);
});

// ================= MODIFIER =================
app.get('/transferts/edit/:id',requireLogin, async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`
<h2>Modifier</h2>
<form method="post">
<input name="amount" value="${t.amount}">
<input name="fees" value="${t.fees}">
<button>Enregistrer</button>
</form>
`);
});

app.post('/transferts/edit/:id',requireLogin, async(req,res)=>{
await Transfert.findByIdAndUpdate(req.params.id,{
  amount:+req.body.amount,
  fees:+req.body.fees,
  recoveryAmount:req.body.amount-req.body.fees
});
res.redirect('/transferts/list');
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id',requireLogin, async(req,res)=>{
await Transfert.findByIdAndDelete(req.params.id);
res.redirect('/transferts/list');
});

// ================= TICKET =================
app.get('/transferts/print/:id',requireLogin, async(req,res)=>{
const t=await Transfert.findById(req.params.id);
res.send(`
<h3>Ticket</h3>
<p>Code: ${t.code}</p>
<p>${t.amount} ${t.currency}</p>
<button onclick="window.print()">Imprimer</button>
`);
});

// ================= PDF =================
app.get('/transferts/pdf',requireLogin, async(req,res)=>{
const list=await Transfert.find();
const doc=new PDFDocument();
res.setHeader('Content-Type','application/pdf');
doc.pipe(res);
doc.text('RAPPORT');
list.forEach(t=>doc.text(`${t.code} - ${t.amount} ${t.currency}`));
doc.end();
});

// ================= LOGOUT =================
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')));

// ================= SERVEUR =================
const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log('🚀 Serveur lancé'));
