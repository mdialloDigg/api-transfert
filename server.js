require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== SESSION =====
app.use(session({
  secret: process.env.SESSION_SECRET || 'transfert-secret-final',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*8 }
}));

// ===== DATABASE =====
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
  .then(()=>console.log('✅ MongoDB connecté'))
  .catch(err=>{ console.error(err); process.exit(1); });

// ===== SCHEMAS =====
const transfertSchema = new mongoose.Schema({
  userType: { type:String, enum:['Client','Distributeur','Administrateur','Agence de transfert'], required:true },
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
  received:Number,
  currency:{ type:String, enum:['GNF','EUR','USD','XOF'], default:'GNF' },
  recoveryMode:String,
  retraitHistory:[{ date:Date, mode:String }],
  retired:{ type:Boolean, default:false },
  code:{ type:String, unique:true },
  createdAt:{ type:Date, default:Date.now }
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const stockSchema = new mongoose.Schema({
  code:{ type:String, unique:true },
  sender:String,
  senderPhone:String,
  destination:String,
  destinationPhone:String,
  amount:Number,
  currency:{ type:String, default:'GNF' },
  createdAt:{ type:Date, default:Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

const stockHistorySchema = new mongoose.Schema({
  code:String,
  action:String,
  stockId:mongoose.Schema.Types.ObjectId,
  sender:String,
  senderPhone:String,
  destination:String,
  destinationPhone:String,
  amount:Number,
  balance:Number,
  currency:String,
  date:{ type:Date, default:Date.now }
});
const StockHistory = mongoose.model('StockHistory', stockHistorySchema);

const clientSchema = new mongoose.Schema({
  firstName:String,
  lastName:String,
  phone:String,
  email:String,
  kycVerified:{ type:Boolean, default:false },
  createdAt:{ type:Date, default:Date.now }
});
const Client = mongoose.model('Client', clientSchema);

const rateSchema = new mongoose.Schema({
  from:String,
  to:String,
  rate:Number,
  createdAt:{ type:Date, default:Date.now }
});
const Rate = mongoose.model('Rate', rateSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{ type:String, enum:['admin','agent'], default:'agent' }
});
const Auth = mongoose.model('Auth', authSchema);

// ===== UTILS =====
async function generateUniqueCode(){
  let code, exists=true;
  while(exists){
    const letter=String.fromCharCode(65+Math.floor(Math.random()*26));
    const number=Math.floor(100+Math.random()*900);
    code=`${letter}${number}`;
    exists = await Transfert.findOne({code}) || await Stock.findOne({code});
  }
  return code;
}

const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect('/login'); };
function setPermissions(username){
  if(username==='a') return { lecture:true,ecriture:false,retrait:true,modification:false,suppression:false,imprimer:true };
  if(username==='admin2') return { lecture:true,ecriture:true,retrait:false,modification:true,suppression:true,imprimer:true };
  return { lecture:true,ecriture:true,retrait:true,modification:true,suppression:true,imprimer:true };
}

// ===== LOGIN =====
app.get('/login',(req,res)=>{
  res.sendFile(path.join(__dirname,'public/login.html'));
});
app.post('/login', async(req,res)=>{
  const {username,password}=req.body;
  let user = await Auth.findOne({username});
  if(!user){ const hashed=bcrypt.hashSync(password,10); user=await new Auth({username,password:hashed}).save(); }
  if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
  req.session.user={ username:user.username, role:user.role, permissions:setPermissions(username) };
  res.redirect('/dashboard.html');
});
app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/login')); });

// ===== CRUD TRANSFERT =====
app.get('/transfert/:id', requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  res.json(t);
});
app.post('/transfert/new', requireLogin, async(req,res)=>{
  try{
    const data=req.body;
    if(data._id) await Transfert.findByIdAndUpdate(data._id,data,{new:true});
    else { data.code=await generateUniqueCode(); data.userType='Client'; await new Transfert(data).save(); }
    res.json({success:true});
  }catch(err){ console.error(err); res.status(500).json({success:false}); }
});
app.post('/transfert/delete', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.body.id);
  res.json({success:true});
});
app.post('/transfert/retirer', requireLogin, async(req,res)=>{
  try{
    const {id,mode} = req.body;
    const t = await Transfert.findById(id);
    if(!t) return res.status(404).json({error:'Introuvable'});
    if(t.retired) return res.status(400).json({error:'Déjà retiré'});
    const montantRetire = t.amount - t.fees;
    const stock = await StockHistory.findOne({destination:t.destinationLocation,currency:t.currency});
    if(!stock) return res.status(400).json({error:'Stock introuvable'});
    if(stock.amount<montantRetire) return res.status(400).json({error:'Stock insuffisant'});
    stock.amount-=montantRetire; await stock.save();
    t.retired=true; t.retraitHistory.push({date:new Date(),mode:mode||'ESPECE'}); await t.save();
    res.json({success:true});
  }catch(err){ console.error(err); res.status(500).json({error:err.message}); }
});

// ===== CRUD STOCK =====
app.get('/stock/:id', requireLogin, async(req,res)=>{
  const s = await StockHistory.findById(req.params.id);
  res.json(s);
});
app.post('/stock/new', requireLogin, async(req,res)=>{
  try{
    let stock;
    if(req.body._id){ stock = await StockHistory.findByIdAndUpdate(req.body._id,req.body,{new:true}); }
    else { req.body.code=await generateUniqueCode(); stock = await new StockHistory(req.body).save(); }
    res.json({success:true});
  }catch(err){ console.error(err); res.status(500).json({success:false}); }
});
app.post('/stock/delete', requireLogin, async(req,res)=>{
  await StockHistory.findByIdAndDelete(req.body.id);
  res.json({success:true});
});

// ===== CRUD CLIENT =====
app.post('/client/new', requireLogin, async(req,res)=>{
  if(req.body._id) await Client.findByIdAndUpdate(req.body._id,req.body,{new:true});
  else await new Client(req.body).save();
  res.json({success:true});
});
app.post('/client/delete', requireLogin, async(req,res)=>{
  await Client.findByIdAndDelete(req.body.id);
  res.json({success:true});
});

// ===== CRUD RATE =====
app.post('/rate/new', requireLogin, async(req,res)=>{
  if(req.body._id) await Rate.findByIdAndUpdate(req.body._id,req.body,{new:true});
  else await new Rate(req.body).save();
  res.json({success:true});
});
app.post('/rate/delete', requireLogin, async(req,res)=>{
  await Rate.findByIdAndDelete(req.body.id);
  res.json({success:true});
});

// ===== EXPORT PDF =====
app.get('/export/pdf', requireLogin, async(req,res)=>{
  const doc = new PDFDocument();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename=export.pdf');
  const transferts = await Transfert.find().sort({createdAt:-1});
  doc.text('Liste des transferts\n\n');
  transferts.forEach(t=>doc.text(`Code: ${t.code} - Exp: ${t.senderFirstName} - Dest: ${t.receiverFirstName} - Montant: ${t.amount} ${t.currency} - Status: ${t.retired?'Retiré':'Non retiré'}`));
  doc.pipe(res); doc.end();
});

// ===== EXPORT EXCEL =====
app.get('/export/excel', requireLogin, async(req,res)=>{
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');
  sheet.columns = [
    {header:'Code', key:'code', width:10},
    {header:'Expéditeur', key:'sender', width:20},
    {header:'Destinataire', key:'receiver', width:20},
    {header:'Montant', key:'amount', width:10},
    {header:'Frais', key:'fees', width:10},
    {header:'Reçu', key:'received', width:10},
    {header:'Devise', key:'currency', width:10},
    {header:'Status', key:'status', width:10},
  ];
  const transferts = await Transfert.find();
  transferts.forEach(t=>sheet.addRow({
    code:t.code,sender:t.senderFirstName,receiver:t.receiverFirstName,
    amount:t.amount,fees:t.fees,received:t.received,
    currency:t.currency,status:t.retired?'Retiré':'Non retiré'
  }));
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
  await workbook.xlsx.write(res); res.end();
});

// ===== RECHERCHE TRANSFERTS AJAX =====
app.get('/transferts/list', requireLogin, async(req,res)=>{
  const {searchPhone, searchCode, searchName, destination='all'} = req.query;
  let filter={};
  if(destination!=='all') filter.destinationLocation=destination;
  if(searchPhone) filter.$or=[{senderPhone:{$regex:searchPhone,$options:'i'}},{receiverPhone:{$regex:searchPhone,$options:'i'}}];
  if(searchCode) filter.code={$regex:searchCode,$options:'i'};
  if(searchName) filter.$or=[{receiverFirstName:{$regex:searchName,$options:'i'}},{receiverLastName:{$regex:searchName,$options:'i'}}];
  const transferts = await Transfert.find(filter).sort({destinationLocation:1});
  res.json(transferts);
});

// ===== SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('🚀 Serveur lancé sur le port '+PORT));
