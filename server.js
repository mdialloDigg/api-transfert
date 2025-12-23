/* ================= IMPORTS ================= */
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // v4+
const cors = require('cors');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= MONGODB ================= */
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test')
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(console.error);

/* ================= SESSION ================= */
app.use(session({
  name: 'transfert.sid',
  secret: process.env.SESSION_SECRET || 'transfert-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/test',
    collectionName: 'sessions'
  }),
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 12 } // 12 heures
}));

/* ================= SCHEMAS ================= */
const userSchema = new mongoose.Schema({
  senderFirstName: String,
  senderLastName: String,
  senderPhone: String,
  originLocation: String,
  amount: Number,
  fees: Number,
  feePercent: Number,
  receiverFirstName: String,
  receiverLastName: String,
  receiverPhone: String,
  destinationLocation: String,
  recoveryAmount: Number,
  recoveryMode: String,
  code: String,
  status: { type: String, default: 'actif' },
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const authUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});
const AuthUser = mongoose.model('AuthUser', authUserSchema);

/* ================= AUTH MIDDLEWARE ================= */
function requireLogin(req,res,next){
  if(req.session.userId) return next();
  res.redirect('/login');
}

/* ================= LOGIN / REGISTER ================= */
app.get('/login', (req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h2>🔑 Connexion</h2>
<form method="post" action="/login">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Connexion</button>
</form>
<p>Pas de compte ? <a href="/register">Créer un compte</a></p>
</body></html>`);
});

app.post('/login', async (req,res)=>{
  const {username,password}=req.body;
  const user = await AuthUser.findOne({username});
  if(!user) return res.send("Utilisateur inconnu");
  const match = await bcrypt.compare(password,user.password);
  if(!match) return res.send("Mot de passe incorrect");
  req.session.userId=user._id;
  res.redirect('/users/choice');
});

app.get('/register', (req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h2>📝 Créer un compte</h2>
<form method="post" action="/register">
<input type="text" name="username" placeholder="Nom d'utilisateur" required><br><br>
<input type="password" name="password" placeholder="Mot de passe" required><br><br>
<button>Créer</button>
</form>
<p>Déjà un compte ? <a href="/login">Se connecter</a></p>
</body></html>`);
});

app.post('/register', async (req,res)=>{
  const {username,password}=req.body;
  const hashedPassword=await bcrypt.hash(password,10);
  try{
    await new AuthUser({username,password:hashedPassword}).save();
    res.send("✅ Compte créé ! <a href='/login'>Se connecter</a>");
  }catch(err){
    res.send("Erreur, nom d'utilisateur déjà pris");
  }
});

app.get('/logout',(req,res)=>{
  req.session.destroy(()=>res.redirect('/login'));
});

/* ================= USERS CHOICE ================= */
app.get('/users/choice', requireLogin, (req,res)=>{
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:40px">
<h2>📋 Gestion des transferts</h2>
<a href="/users/lookup?mode=new"><button>💾 Nouveau transfert</button></a><br><br>
<a href="/users/lookup?mode=edit"><button>✏️ Modifier transfert</button></a><br><br>
<a href="/users/lookup?mode=delete"><button>❌ Supprimer transfert</button></a><br><br>
<a href="/users/all"><button>📋 Liste complète</button></a><br><br>
<a href="/logout">🚪 Déconnexion</a>
</body></html>`);
});

/* ================= LOOKUP ================= */
app.get('/users/lookup', requireLogin, (req,res)=>{
  const mode = req.query.mode || 'edit';
  req.session.choiceMode = mode;
  res.send(`<html><body style="font-family:Arial;text-align:center;padding-top:50px">
<h3>📞 Numéro expéditeur</h3>
<form method="post" action="/users/lookup">
<input name="phone" required><br><br>
<button>Continuer</button>
</form><br><a href="/users/choice">🔙 Retour</a>
</body></html>`);
});

app.post('/users/lookup', requireLogin, async (req,res)=>{
  const u = await User.findOne({senderPhone:req.body.phone}).sort({createdAt:-1});
  req.session.prefill = u || {senderPhone:req.body.phone};
  if(req.session.choiceMode==='new') req.session.editId=null;
  else if(u) req.session.editId=u._id;
  else if(req.session.choiceMode==='edit') req.session.editId=null;
  else if(req.session.choiceMode==='delete'){
    if(u){
      await User.findByIdAndDelete(u._id);
      req.session.prefill=null; req.session.editId=null;
      return res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:50px">
❌ Transfert supprimé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
    }else{
      return res.send(`<html><body style="text-align:center;font-family:Arial;padding-top:50px">
Aucun transfert trouvé<br><br><a href="/users/choice">🔙 Retour</a></body></html>`);
    }
  }
  res.redirect('/users/form');
});

/* ================= FORMULAIRE / CRUD / RETRAIT / PDF ================= */
// Ici tu peux copier tout ton code existant de formulaire, CRUD, retrait dropdown, liste complète avec sous-totaux et export PDF
// Le point clé est que la session MongoDB fonctionne maintenant parfaitement avec `MongoStore.create({...})`.

const PORT=process.env.PORT||3000;
app.listen(PORT,'0.0.0.0',()=>console.log(`🚀 Serveur prêt sur le port ${PORT}`));
