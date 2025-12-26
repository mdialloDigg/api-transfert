// server.js
import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import path from "path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: "secret123",
    resave: false,
    saveUninitialized: true
}));

// ----- MONGOOSE -----
mongoose.connect("mongodb://localhost/transferts", { useNewUrlParser: true, useUnifiedTopology: true });

const transfertSchema = new mongoose.Schema({
    code: String,
    userType: String,
    senderFirstName: String,
    senderLastName: String,
    senderPhone: String,
    originLocation: String,
    receiverFirstName: String,
    receiverLastName: String,
    receiverPhone: String,
    amount: Number,
    fees: Number,
    recoveryAmount: Number,
    currency: String,
    destinationLocation: String,
    retired: { type: Boolean, default: false },
    retireMode: String
});

const Transfert = mongoose.model("Transfert", transfertSchema);

// ----- LOGIN SIMPLIFIE -----
app.get("/login", (req, res) => {
    res.send(`<form method="POST" action="/login">
        <input name="user" placeholder="Utilisateur"/>
        <select name="role"><option value="admin">admin</option><option value="admin2">admin2</option></select>
        <button>Login</button>
    </form>`);
});
app.post("/login", (req, res) => {
    req.session.user = { name: req.body.user, role: req.body.role };
    res.redirect("/transferts/list");
});
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    next();
}

// ----- LISTE DES TRANSFERTS -----
app.get("/transferts/list", requireLogin, async (req, res) => {
    const user = req.session.user;
    const transferts = await Transfert.find().lean();
    const optionsCurrency = [...new Set(transferts.map(t => t.currency))].map(c => `<option>${c}</option>`).join('');
    const optionsLocation = [...new Set(transferts.map(t => t.destinationLocation))].map(l => `<option>${l}</option>`).join('');

    res.send(`<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
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
@media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}
</style></head>
<body>
<h2>📋 Liste des transferts</h2>
<div>
<input id="search" placeholder="Recherche...">
<select id="status"><option value="all">Tous</option><option value="retire">Retirés</option><option value="non">Non retirés</option></select>
<select id="currency"><option value="">Toutes devises</option>${optionsCurrency}</select>
<select id="destination"><option value="">Toutes destinations</option>${optionsLocation}</select>
<button onclick="loadData()">🔍 Filtrer</button>
<a href="/logout">🚪 Déconnexion</a>
<a href="/transferts/excel">📊 Excel</a>
<a href="/transferts/word">📝 Word</a>
<a href="/transferts/new">➕ Nouveau transfert</a>
<table>
<thead>
<tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
</thead>
<tbody id="tbody"></tbody>
</table>
<h3>📊 Totaux par destination et devise</h3>
<div id="totaux"></div>
</div>
<script>
const role = "${user.role}";
async function loadData(){
  const search = document.getElementById("search").value;
  const status = document.getElementById("status").value;
  const currency = document.getElementById("currency").value;
  const destination = document.getElementById("destination").value;

  const response = await fetch("/transferts/data?search="+encodeURIComponent(search)
    +"&status="+encodeURIComponent(status)
    +"&currency="+encodeURIComponent(currency)
    +"&destination="+encodeURIComponent(destination));
    
  const data = await response.json();
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  const totals = {};

  data.forEach(t => {
    const tr = document.createElement("tr");
    if(t.retired) tr.className="retired";
    let actions = `<button class='modify' onclick='edit("${t._id}")'>✏️</button>
                   <button class='delete' onclick='remove("${t._id}")'>❌</button>
                   <button class='imprimer' onclick='imprimer("${t._id}")'>🖨</button>`;
    if(role==='admin') actions += `<button class='retirer' onclick='retirer("${t._id}")'>💰</button>`;
    tr.innerHTML = `<td>${t.code}</td>
                    <td>${t.userType}</td>
                    <td>${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
                    <td>${t.originLocation}</td>
                    <td>${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
                    <td>${t.amount}</td>
                    <td>${t.fees}</td>
                    <td>${t.recoveryAmount}</td>
                    <td>${t.currency}</td>
                    <td>${t.retired?"Retiré":"Non retiré"}</td>
                    <td>${actions}</td>`;
    tbody.appendChild(tr);

    if(!totals[t.destinationLocation]) totals[t.destinationLocation] = {};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency] = {amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  const divtot = document.getElementById("totaux");
  divtot.innerHTML = "";
  for(let dest in totals){
    for(let curr in totals[dest]){
      divtot.innerHTML += `<p>${dest} | ${curr} : Montant=${totals[dest][curr].amount}, Frais=${totals[dest][curr].fees}, Reçu=${totals[dest][curr].recovery}</p>`;
    }
  }
}

function edit(id){window.location="/transferts/form?id="+id;}
function remove(id){fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData);}
function retirer(id){ 
  if(role!=='admin'){alert('Vous n’avez pas le droit de retirer'); return;}
  const mode=prompt('Mode de retrait: Espèces, Orange Money, Wave'); 
  if(mode) fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData);
}
function imprimer(id){window.open('/transferts/print/'+id,'_blank');}
window.onload = loadData;
</script>
</body></html>`);
});

// ----- API DATA -----
app.get("/transferts/data", requireLogin, async (req, res) => {
    const { search="", status="all", currency="", destination="" } = req.query;
    let query = {};
    if(search) query.code = { $regex: search, $options: "i" };
    if(status==="retire") query.retired = true;
    if(status==="non") query.retired = false;
    if(currency) query.currency = currency;
    if(destination) query.destinationLocation = destination;
    const transferts = await Transfert.find(query).lean();
    res.json(transferts);
});

// ----- SUPPRESSION -----
app.delete("/transferts/delete/:id", requireLogin, async (req, res) => {
    await Transfert.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
});

// ----- RETRAIT -----
app.post("/transferts/retirer", requireLogin, async (req, res) => {
    if(req.session.user.role !== "admin") return res.status(403).send("Interdit");
    const { id, mode } = req.body;
    await Transfert.findByIdAndUpdate(id, { retired: true, retireMode: mode });
    res.sendStatus(200);
});

// ----- CREATION ET MODIF -----
app.get("/transferts/form", requireLogin, async (req,res) => {
    let t = { code:"", userType:"", senderFirstName:"", senderLastName:"", senderPhone:"", originLocation:"", receiverFirstName:"", receiverLastName:"", receiverPhone:"", amount:0, fees:0, recoveryAmount:0, currency:"", destinationLocation:"" };
    if(req.query.id){
        t = await Transfert.findById(req.query.id).lean();
    }
    res.send(`<form method="POST" action="/transferts/save">
        <input name="id" type="hidden" value="${t._id || ""}"/>
        Code: <input name="code" value="${t.code}"/><br/>
        Type: <input name="userType" value="${t.userType}"/><br/>
        Expéditeur: <input name="senderFirstName" value="${t.senderFirstName}"/> <input name="senderLastName" value="${t.senderLastName}"/> <input name="senderPhone" value="${t.senderPhone}"/><br/>
        Origine: <input name="originLocation" value="${t.originLocation}"/><br/>
        Destinataire: <input name="receiverFirstName" value="${t.receiverFirstName}"/> <input name="receiverLastName" value="${t.receiverLastName}"/> <input name="receiverPhone" value="${t.receiverPhone}"/><br/>
        Montant: <input name="amount" value="${t.amount}"/><br/>
        Frais: <input name="fees" value="${t.fees}"/><br/>
        Reçu: <input name="recoveryAmount" value="${t.recoveryAmount}"/><br/>
        Devise: <input name="currency" value="${t.currency}"/><br/>
        Destination: <input name="destinationLocation" value="${t.destinationLocation}"/><br/>
        <button>Enregistrer</button>
    </form>`);
});
app.post("/transferts/save", requireLogin, async (req,res)=>{
    const {id, code, userType, senderFirstName, senderLastName, senderPhone, originLocation, receiverFirstName, receiverLastName, receiverPhone, amount, fees, recoveryAmount, currency, destinationLocation} = req.body;
    if(id) await Transfert.findByIdAndUpdate(id,{code, userType, senderFirstName, senderLastName, senderPhone, originLocation, receiverFirstName, receiverLastName, receiverPhone, amount, fees, recoveryAmount, currency, destinationLocation});
    else await Transfert.create({code, userType, senderFirstName, senderLastName, senderPhone, originLocation, receiverFirstName, receiverLastName, receiverPhone, amount, fees, recoveryAmount, currency, destinationLocation});
    res.redirect("/transferts/list");
});

// ----- EXPORT WORD -----
app.get("/transferts/word", requireLogin, async (req,res)=>{
    const transferts = await Transfert.find().lean();
    const doc = new Document();
    transferts.forEach(t=>{
        doc.addSection({children:[new Paragraph({children:[new TextRun(`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Status: ${t.retired?'Retiré':'Non retiré'}`)])}]});
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Disposition","attachment; filename=transferts.docx");
    res.send(buffer);
});

// ----- EXPORT EXCEL -----
app.get("/transferts/excel", requireLogin, async (req,res)=>{
    const transferts = await Transfert.find().lean();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Transferts");
    sheet.addRow(["Code","Type","Expéditeur","Origine","Destinataire","Montant","Frais","Reçu","Devise","Status"]);
    transferts.forEach(t=>{
        sheet.addRow([t.code,t.userType,`${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,t.originLocation,`${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,t.amount,t.fees,t.recoveryAmount,t.currency,t.retired?'Retiré':'Non retiré']);
    });
    res.setHeader("Content-Disposition","attachment; filename=transferts.xlsx");
    await workbook.xlsx.write(res);
    res.end();
});

// ----- IMPRESSION -----
app.get("/transferts/print/:id", requireLogin, async (req,res)=>{
    const t = await Transfert.findById(req.params.id).lean();
    res.send(`<h1>Transfert ${t.code}</h1>
<p>Expéditeur: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
<p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
<p>Montant: ${t.amount} ${t.currency}</p>
<p>Status: ${t.retired?'Retiré':'Non retiré'}</p>
<script>window.print()</script>`);
});

// ----- LOGOUT -----
app.get("/logout",(req,res)=>{req.session.destroy();res.redirect("/login");});

app.listen(PORT,()=>console.log(`Server running on ${PORT}`));
