const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const app = express();

// ================= CONFIG =================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'transfert-secret', resave: false, saveUninitialized: true }));
app.use(express.static('public')); // Pour CSS/JS

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('✅ MongoDB connecté')).catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType:String,senderFirstName:String,senderLastName:String,senderPhone:String,
  originLocation:String,receiverFirstName:String,receiverLastName:String,receiverPhone:String,
  destinationLocation:String,amount:Number,fees:Number,recoveryAmount:Number,
  currency:{type:String,enum:['GNF','EUR','USD','XOF'],default:'GNF'},
  retraitHistory:[{date:Date,mode:String}],retired:{type:Boolean,default:false},
  code:{type:String,unique:true},createdAt:{type:Date,default:Date.now}
});
const Transfert = mongoose.model('Transfert', transfertSchema);

const authSchema = new mongoose.Schema({username:String,password:String,role:{type:String,enum:['admin','agent'],default:'agent'}});
const Auth = mongoose.model('Auth', authSchema);

// ================= UTIL =================
async function generateUniqueCode(){
  let code,exists=true;
  while(exists){
    code=`${String.fromCharCode(65+Math.floor(Math.random()*26))}${Math.floor(100+Math.random()*900)}`;
    exists=await Transfert.findOne({code});
  }
  return code;
}

// ================= AUTH =================
const requireLogin=(req,res,next)=>{if(req.session.user) return next(); res.redirect('/login');};

// ================= LOGIN =================
app.get('/login',(req,res)=>{
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font-family:Arial;text-align:center;padding-top:80px;}form{background:#fff;padding:30px;border-radius:12px;display:inline-block;}
  input,button{padding:12px;margin:8px;width:250px;border-radius:6px;border:1px solid #ccc;}button{background:#007bff;color:white;border:none;cursor:pointer;}
  button:hover{background:#0056b3;}</style></head><body>
  <h2>Connexion</h2>
  <form method="post">
  <input name="username" placeholder="Utilisateur" required><br>
  <input type="password" name="password" placeholder="Mot de passe" required><br>
  <button>Connexion</button>
  </form></body></html>`);
});
app.post('/login', async(req,res)=>{
  try{
    const {username,password}=req.body;
    let user=await Auth.findOne({username});
    if(!user){
      const hashed=bcrypt.hashSync(password,10);
      user=await new Auth({username,password:hashed,role:'admin'}).save();
    }
    else if(!bcrypt.compareSync(password,user.password)) return res.send('Mot de passe incorrect');
    req.session.user=username;
    req.session.role=user.role;
    res.redirect('/transferts/list');
  }catch(e){res.status(500).send(e.message);}
});
app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'));});

// ================= LOCATIONS & CURRENCIES =================
const locations=['France','Belgique','Conakry','Suisse','Atlanta','New York','Allemagne'];
const currencies=['GNF','EUR','USD','XOF'];

// ================= FORMULAIRE =================
app.get('/transferts/form', requireLogin, async(req,res)=>{
  let t=null;
  if(req.query.code) t=await Transfert.findOne({code:req.query.code});
  const code=t?t.code:await generateUniqueCode();
  res.sendFile(__dirname+'/public/form.html'); // Front-end form
});

// ================= POST FORM =================
app.post('/transferts/form', requireLogin, async(req,res)=>{
  try{
    const amount=Number(req.body.amount||0);
    const fees=Number(req.body.fees||0);
    const recoveryAmount=amount-fees;
    const code=req.body.code||await generateUniqueCode();
    let existing=await Transfert.findOne({code});
    if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body,amount,fees,recoveryAmount});
    else await new Transfert({...req.body,amount,fees,recoveryAmount,retraitHistory:[],code}).save();
    res.redirect('/transferts/list?search='+code);
  }catch(e){res.status(500).send(e.message);}
});

// ================= LISTE =================
app.get('/transferts/list', requireLogin, async(req,res)=>{
  let {search='',status='all',page=1,limit=10}=req.query;
  page=Number(page); limit=Number(limit);
  let transferts=await Transfert.find().sort({createdAt:-1});
  if(search) transferts=transferts.filter(t=>Object.values(t.toObject()).some(v=>v&&v.toString().toLowerCase().includes(search.toLowerCase())));
  if(status==='retire') transferts=transferts.filter(t=>t.retired);
  else if(status==='non') transferts=transferts.filter(t=>!t.retired);
  const total=Math.ceil(transferts.length/limit);
  const pages=Array.from({length:total},(_,i)=>({num:i+1,active:i+1===page}));
  transferts=transferts.slice((page-1)*limit,page*limit);
  res.render('list',{transferts,pages,search,status});
});

// ================= RETIRER =================
app.post('/transferts/retirer', requireLogin, async(req,res)=>{
  try{
    await Transfert.findByIdAndUpdate(req.body.id,{
      retired:true,
      $push:{retraitHistory:{date:new Date(),mode:req.body.mode}}
    });
    res.sendStatus(200);
  }catch(e){res.status(500).send(e.message);}
});

// ================= SUPPRIMER =================
app.get('/transferts/delete/:id', requireLogin, async(req,res)=>{
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect('/transferts/list');
});

// ================= PDF =================
app.get('/transferts/pdf', requireLogin, async(req,res)=>{
  try{
    const transferts=await Transfert.find().sort({createdAt:-1});
    const doc=new PDFDocument({margin:30,size:'A4'});
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename=transferts.pdf');
    doc.pipe(res);
    doc.fontSize(18).text('RAPPORT DES TRANSFERTS',{align:'center'}).moveDown();
    transferts.forEach(t=>{
      doc.fontSize(12).fillColor('#007bff').text(`Code: ${t.code} | Type: ${t.userType}`);
      doc.fontSize(10).fillColor('black')
      .text(`Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone}) | Origine: ${t.originLocation}`)
      .text(`Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone}) | Destination: ${t.destinationLocation}`)
      .text(`Montant: ${t.amount} ${t.currency} | Frais: ${t.fees} | Reçu: ${t.recoveryAmount} | Statut: ${t.retired?'Retiré':'Non retiré'}`);
      if(t.retraitHistory.length) t.retraitHistory.forEach(h=>doc.text(`→ Retiré le ${new Date(h.date).toLocaleString()} via ${h.mode}`));
      doc.moveDown(0.5);
    });
    doc.end();
  }catch(e){res.status(500).send(e.message);}
});

// ================= EXCEL =================
app.get('/transferts/excel', requireLogin, async(req,res)=>{
  try{
    const transferts=await Transfert.find().sort({createdAt:-1});
    const workbook=new ExcelJS.Workbook();
    const sheet=workbook.addWorksheet('Transferts');
    sheet.columns=[
      {header:'Code', key:'code', width:10},
      {header:'Type', key:'userType', width:15},
      {header:'Expéditeur', key:'sender', width:25},
      {header:'Origine', key:'origin', width:15},
      {header:'Destinataire', key:'receiver', width:25},
      {header:'Destination', key:'destination', width:15},
      {header:'Montant', key:'amount', width:12},
      {header:'Frais', key:'fees', width:12},
      {header:'Reçu', key:'recovery', width:12},
      {header:'Statut', key:'status', width:12},
      {header:'Historique', key:'history', width:30}
    ];
    transferts.forEach(t=>{
      sheet.addRow({
        code:t.code,userType:t.userType,
        sender:`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
        origin:t.originLocation,
        receiver:`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
        destination:t.destinationLocation,
        amount:t.amount,fees:t.fees,recovery:t.recoveryAmount,
        status:t.retired?'Retiré':'Non retiré',
        history:t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('; ')
      });
    });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=transferts.xlsx');
    await workbook.xlsx.write(res); res.end();
  }catch(e){res.status(500).send(e.message);}
});

// ================= SERVEUR =================
app.set('view engine','ejs');
app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur le port 3000'));
