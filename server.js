/******************************************************************
 * APP TRANSFERT – DASHBOARD FINAL AVEC TOTAUX, AJAX, EXPORTS
 ******************************************************************/

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const bodyParser = require("body-parser");

const app = express();

// ================= CONFIG =================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: "transfert-secret-final",
  resave: false,
  saveUninitialized: true
}));

// ================= DATABASE =================
mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/transfert")
  .then(() => console.log("✅ MongoDB connecté"))
  .catch(console.error);

// ================= SCHEMAS =================
const transfertSchema = new mongoose.Schema({
  userType: { type: String, enum: ["Client","Distributeur","Administrateur","Agence de transfert"], required:true },
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
  currency: { type: String, enum:["GNF","EUR","USD","XOF"], default:"GNF" },
  recoveryMode: String,
  retraitHistory: [{ date: Date, mode: String }],
  retired: { type: Boolean, default: false },
  code: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Transfert = mongoose.model("Transfert", transfertSchema);

const authSchema = new mongoose.Schema({
  username:String,
  password:String,
  role:{type:String, enum:["admin","agent"], default:"agent"}
});
const Auth = mongoose.model("Auth", authSchema);

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
const requireLogin = (req,res,next)=>{ if(req.session.user) return next(); res.redirect("/login"); };

function setPermissions(username){
  let permissions = { lecture:true, ecriture:false, retrait:false, modification:true, suppression:true, imprimer:true };
  if(username==="a") permissions = { lecture:true, ecriture:false, retrait:true, modification:false, suppression:false, imprimer:true };
  if(username==="admin2") permissions = { lecture:true, ecriture:true, retrait:false, modification:true, suppression:true, imprimer:true };
  return permissions;
}

const locations = ["France","Belgique","Conakry","Suisse","Atlanta","New York","Allemagne"];
const currencies = ["GNF","EUR","USD","XOF"];

// ================= LOGIN / LOGOUT =================
app.get("/login", (req,res)=>{
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

app.post("/login", async (req,res)=>{
  try{
    const { username, password } = req.body;
    let user = await Auth.findOne({ username }).exec();
    if(!user){
      const hashed = bcrypt.hashSync(password,10);
      user = await new Auth({ username, password: hashed }).save();
    }
    if(!bcrypt.compareSync(password,user.password)) return res.send("Mot de passe incorrect");
    const permissions = setPermissions(username);
    req.session.user = { username:user.username, role:user.role, permissions };
    res.redirect("/transferts/list");
  }catch(err){ console.error(err); res.status(500).send("Erreur serveur: "+err.message);}
});

app.get("/logout",(req,res)=>{ req.session.destroy(()=>res.redirect("/login")); });

// ================= FORMULAIRE =================
app.get("/transferts/form", requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send("Accès refusé");
  let t = null;
  if(req.query.code) t = await Transfert.findOne({ code:req.query.code });
  const code = t ? t.code : await generateUniqueCode();
  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{margin:0;font-family:Arial,sans-serif;background:#f0f4f8}
  .container{max-width:800px;margin:40px auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,0.15);}
  h2{color:#2c7be5;text-align:center;margin-bottom:20px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:15px;}
  label{display:block;margin-bottom:5px;font-weight:bold;color:#555;}
  input,select{width:100%;padding:10px;border-radius:6px;border:1px solid #ccc;font-size:14px;}
  input[readonly]{background:#e9ecef;}
  button{width:100%;padding:12px;background:#2eb85c;color:white;border:none;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;transition:0.3s;}
  button:hover{background:#218838;}
  a{display:inline-block;margin-top:15px;color:#2c7be5;text-decoration:none;font-weight:bold;}
  a:hover{text-decoration:underline;}
  </style></head><body>
  <div class="container">
  <h2>${t?'✏️ Modifier':'➕ Nouveau'} Transfert</h2>
  <form method="post">
  <h3>Type de personne</h3>
  <select name="userType">
  <option ${t&&t.userType==='Client'?'selected':''}>Client</option>
  <option ${t&&t.userType==='Distributeur'?'selected':''}>Distributeur</option>
  <option ${t&&t.userType==='Administrateur'?'selected':''}>Administrateur</option>
  <option ${t&&t.userType==='Agence de transfert'?'selected':''}>Agence de transfert</option>
  </select>

  <h3>Expéditeur</h3><div class="grid">
  <div><label>Prénom</label><input name="senderFirstName" required value="${t?t.senderFirstName:''}"></div>
  <div><label>Nom</label><input name="senderLastName" required value="${t?t.senderLastName:''}"></div>
  <div><label>Téléphone</label><input name="senderPhone" required value="${t?t.senderPhone:''}"></div>
  <div><label>Origine</label><select name="originLocation">${locations.map(v=>`<option ${t&&t.originLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
  </div>

  <h3>Destinataire</h3><div class="grid">
  <div><label>Prénom</label><input name="receiverFirstName" required value="${t?t.receiverFirstName:''}"></div>
  <div><label>Nom</label><input name="receiverLastName" required value="${t?t.receiverLastName:''}"></div>
  <div><label>Téléphone</label><input name="receiverPhone" required value="${t?t.receiverPhone:''}"></div>
  <div><label>Destination</label><select name="destinationLocation">${locations.map(v=>`<option ${t&&t.destinationLocation===v?'selected':''}>${v}</option>`).join('')}</select></div>
  </div>

  <h3>Montants & Devise & Code</h3><div class="grid">
  <div><label>Montant</label><input type="number" id="amount" name="amount" required value="${t?t.amount:''}"></div>
  <div><label>Frais</label><input type="number" id="fees" name="fees" required value="${t?t.fees:''}"></div>
  <div><label>Montant à recevoir</label><input type="text" id="recoveryAmount" readonly value="${t?t.recoveryAmount:''}"></div>
  <div><label>Devise</label><select name="currency">${currencies.map(c=>`<option ${t&&t.currency===c?'selected':''}>${c}</option>`).join('')}</select></div>
  <div><label>Code transfert</label><input type="text" name="code" readonly value="${code}"></div>
  </div>

  <button>${t?'Enregistrer Modifications':'Enregistrer'}</button>
  </form>
  <center><a href="/transferts/list">⬅ Retour liste</a></center>
  </div>
  <script>
  const amountField=document.getElementById("amount");
  const feesField=document.getElementById("fees");
  const recoveryField=document.getElementById("recoveryAmount");
  function updateRecovery(){const a=parseFloat(amountField.value)||0;const f=parseFloat(feesField.value)||0;recoveryField.value=a-f;}
  amountField.addEventListener("input",updateRecovery);
  feesField.addEventListener("input",updateRecovery);
  updateRecovery();
  </script>
  </body></html>`);
});

// ================= POST FORMULAIRE =================
app.post("/transferts/form", requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.ecriture) return res.status(403).send("Accès refusé");
  const amount = Number(req.body.amount||0);
  const fees = Number(req.body.fees||0);
  const recoveryAmount = amount - fees;
  const code = req.body.code || await generateUniqueCode();
  let existing = await Transfert.findOne({code});
  if(existing) await Transfert.findByIdAndUpdate(existing._id,{...req.body, amount, fees, recoveryAmount});
  else await new Transfert({...req.body, amount, fees, recoveryAmount, retraitHistory: [], code}).save();
  res.redirect("/transferts/list");
});

// ================= RETRAIT / SUPPRESSION =================
app.post("/transferts/retirer", requireLogin, async(req,res)=>{
  const username = req.session.user.username;
  if(username!=="a") return res.status(403).send("Seul l'utilisateur 'a' peut retirer.");
  const { id, mode } = req.body;
  await Transfert.findByIdAndUpdate(id,{
    retired:true,
    recoveryMode:mode,
    $push:{ retraitHistory:{ date:new Date(), mode } }
  });
  res.send({success:true});
});

app.delete("/transferts/delete/:id", requireLogin, async(req,res)=>{
  if(!req.session.user.permissions.suppression) return res.status(403).send("Accès refusé");
  await Transfert.findByIdAndDelete(req.params.id);
  res.send({success:true});
});

// ================= LISTE AVEC AJAX =================
app.get("/transferts/list", requireLogin, async(req,res)=>{
  const t = await Transfert.find().sort({createdAt:-1});
  let optionsCurrency = currencies.map(c=>`<option value="${c}">${c}</option>`).join("");
  let optionsLocation = locations.map(l=>`<option value="${l}">${l}</option>`).join("");

  res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:Arial;margin:0;padding:10px;background:#f4f6f9;}
  table{width:100%;border-collapse:collapse;background:white;margin-bottom:20px;}
  th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:14px;}
  th{background:#007bff;color:white;}
  .retired{background:#fff3b0;}
  button{padding:5px 8px;border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;margin-right:3px;}
  .modify{background:#28a745;}
  .delete{background:#dc3545;}
  .retirer{background:#ff9900;}
  .imprimer{background:#17a2b8;}
  @media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}</style></head><body>
  <h2>📋 Liste des transferts</h2>
  <div>
  <input id="search" placeholder="Recherche...">
  <select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
  <select id="currency"><option value="">Toutes devises</option>${optionsCurrency}</select>
  <select id="destination"><option value="">Toutes destinations</option>${optionsLocation}</select>
  <button onclick="loadData()">🔍 Filtrer</button>
  <a href="/logout">🚪 Déconnexion</a> <a href="/transferts/excel">📊 Excel</a><a href="/transferts/word">📝 Word</a>
  <table><thead><tr>
  <th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th>
  <th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead>
  <tbody id="tbody"></tbody></table>
  <h3>📊 Totaux par destination et devise</h3><div id="totaux"></div></div>
  <script>
  async function loadData(){
    const search=document.getElementById("search").value;
    const status=document.getElementById("status").value;
    const currency=document.getElementById("currency").value;
    const destination=document.getElementById("destination").value;
    const res=await fetch("/transferts/data?search="+encodeURIComponent(search)+"&status="+encodeURIComponent(status)+"&currency="+encodeURIComponent(currency)+"&destination="+encodeURIComponent(destination));
    const data=await res.json();
    const tbody=document.getElementById("tbody");
    tbody.innerHTML="";
    let totals={};
    data.forEach(t=>{
      let tr=document.createElement("tr");
      if(t.retired) tr.className="retired";
      tr.innerHTML="<td>"+t.code+"</td><td>"+t.userType+"</td><td>"+t.senderFirstName+" "+t.senderLastName+" ("+t.senderPhone+")</td><td>"+t.originLocation+"</td><td>"+t.receiverFirstName+" "+t.receiverLastName+" ("+t.receiverPhone+")</td><td>"+t.amount+"</td><td>"+t.fees+"</td><td>"+t.recoveryAmount+"</td><td>"+t.currency+"</td><td>"+(t.retired?"Retiré":"Non retiré")+"</td><td><button class='modify' onclick='edit(\""+t._id+"\")'>✏️</button><button class='delete' onclick='remove(\""+t._id+"\")'>❌</button><button class='retirer' onclick='retirer(\""+t._id+"\")'>💰</button><button class='imprimer' onclick='imprimer(\""+t._id+"\")'>🖨</button></td>";
      tbody.appendChild(tr);
      if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
      if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
      totals[t.destinationLocation][t.currency].amount+=t.amount;
      totals[t.destinationLocation][t.currency].fees+=t.fees;
      totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
    });
    const divtot=document.getElementById("totaux");
    divtot.innerHTML="";
    for(let dest in totals){
      for(let curr in totals[dest]){
        divtot.innerHTML+="<p>"+dest+" | "+curr+" : Montant="+totals[dest][curr].amount+", Frais="+totals[dest][curr].fees+", Reçu="+totals[dest][curr].recovery+"</p>";
      }
    }
  }

  function edit(id){window.location="/transferts/form?code="+id;}
  function remove(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
  function retirer(id){let mode=prompt('Mode de retrait: Espèces, Orange Money, Wave'); if(mode) fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);}
  function imprimer(id){window.open('/transferts/print/'+id,'_blank');}
  window.onload=loadData;
  </script></body></html>`);
});

// ================= API AJAX =================
app.get("/transferts/data", requireLogin, async(req,res)=>{
  let query={};
  if(req.query.status==='retire') query.retired=true;
  if(req.query.status==='non') query.retired=false;
  if(req.query.currency) query.currency=req.query.currency;
  if(req.query.destination) query.destinationLocation=req.query.destination;
  if(req.query.search){
    const regex=new RegExp(req.query.search,"i");
    query.$or=[
      {senderFirstName:regex},{senderLastName:regex},{receiverFirstName:regex},{receiverLastName:regex},{code:regex}
    ];
  }
  const transferts = await Transfert.find(query).sort({createdAt:-1});
  res.json(transferts);
});

// ================= PRINT =================
app.get("/transferts/print/:id", requireLogin, async(req,res)=>{
  const t = await Transfert.findById(req.params.id);
  if(!t) return res.send("Transfert introuvable");
  res.send(`<html><head><title>Impression</title></head><body>
  <h2>Transfert ${t.code}</h2>
  <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
  <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
  <p>Montant: ${t.amount} ${t.currency}</p>
  <p>Status: ${t.retired?"Retiré":"Non retiré"}</p>
  <button onclick="window.print()">🖨 Imprimer</button>
  </body></html>`);
});

// ================= EXPORT EXCEL =================
app.get("/transferts/excel", requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Transferts");
  sheet.columns = [
    { header:"Code", key:"code" },
    { header:"Type", key:"userType" },
    { header:"Expéditeur", key:"sender" },
    { header:"Destinataire", key:"receiver" },
    { header:"Montant", key:"amount" },
    { header:"Frais", key:"fees" },
    { header:"Reçu", key:"recoveryAmount" },
    { header:"Devise", key:"currency" },
    { header:"Status", key:"retired" }
  ];
  transferts.forEach(t=>sheet.addRow({
    code:t.code,
    userType:t.userType,
    sender:`${t.senderFirstName} ${t.senderLastName}`,
    receiver:`${t.receiverFirstName} ${t.receiverLastName}`,
    amount:t.amount,
    fees:t.fees,
    recoveryAmount:t.recoveryAmount,
    currency:t.currency,
    retired:t.retired?"Retiré":"Non retiré"
  }));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition","attachment; filename=transferts.xlsx");
  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get("/transferts/word", requireLogin, async(req,res)=>{
  const transferts = await Transfert.find();
  const doc = new Document();
  transferts.forEach(t=>{
    doc.addSection({children:[
      new Paragraph({
        children:[new TextRun(`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Status: ${t.retired?"Retiré":"Non retiré"}`)]
      })
    ]});
  });
  const packer = Packer.toBuffer(doc).then(buffer=>{
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition","attachment; filename=transferts.docx");
    res.send(buffer);
  }).catch(console.error);
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log("🚀 Serveur démarré sur http://localhost:"+PORT));
