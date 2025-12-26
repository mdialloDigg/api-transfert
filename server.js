const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const bodyParser = require("body-parser");
const PDFDocument = require("pdfkit");
const XLSX = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

/* ===================== CONFIG ===================== */

mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1/transferts");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: "secret123",
  resave: false,
  saveUninitialized: true
}));

/* ===================== ROLES ===================== */

const ROLES = {
  a: { withdraw: true },
  admin2: { create: true, edit: true, delete: true }
};

function allow(action) {
  return (req, res, next) => {
    const role = req.session.role;
    if (role && ROLES[role] && ROLES[role][action]) next();
    else res.status(403).send("Accès refusé");
  };
}

/* ===================== MODELS ===================== */

const TransfertSchema = new mongoose.Schema({
  code: String,
  sender: String,
  receiver: String,
  amount: Number,
  fees: Number,
  recovery: Number,
  currency: String,
  destination: String,
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const WithdrawalSchema = new mongoose.Schema({
  transfertId: String,
  user: String,
  mode: String,
  date: { type: Date, default: Date.now }
});

const Transfert = mongoose.model("Transfert", TransfertSchema);
const Withdrawal = mongoose.model("Withdrawal", WithdrawalSchema);

/* ===================== AUTH (SIMPLIFIÉ) ===================== */

app.get("/login/:role", (req, res) => {
  req.session.role = req.params.role;
  res.redirect("/");
});

/* ===================== PAGE HTML ===================== */

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:Arial;background:#f4f6f9;padding:10px}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{border:1px solid #ccc;padding:6px;font-size:13px}
th{background:#007bff;color:#fff}
.retired{background:#fff3b0}
button{border:none;padding:5px 7px;border-radius:4px;color:#fff}
.edit{background:#28a745}
.del{background:#dc3545}
.ret{background:#ff9800}
.print{background:#17a2b8}
</style>
</head>
<body>

<h3>📋 Transferts</h3>

<input id="search" placeholder="Recherche">
<select id="status">
<option value="">Tous</option>
<option value="retire">Retiré</option>
<option value="non">Non retiré</option>
</select>
<button onclick="load()">🔍</button>
<button onclick="create()">➕ Nouveau</button>

<table>
<thead>
<tr>
<th>Code</th><th>Expéditeur</th><th>Destinataire</th>
<th>Montant</th><th>Frais</th><th>Reçu</th>
<th>Devise</th><th>Destination</th><th>Status</th><th>Actions</th>
</tr>
</thead>
<tbody id="tbody"></tbody>
</table>

<h4>📊 Totaux</h4>
<div id="totaux"></div>

<script>
async function load(){
  const r = await fetch("/api/transferts?search="+search.value+"&status="+status.value);
  const data = await r.json();
  const tbody = document.getElementById("tbody");
  tbody.innerHTML="";
  let totals={};

  data.forEach(t=>{
    let tr=document.createElement("tr");
    if(t.retired) tr.className="retired";
    tr.innerHTML=
      "<td>"+t.code+"</td>"+
      "<td>"+t.sender+"</td>"+
      "<td>"+t.receiver+"</td>"+
      "<td>"+t.amount+"</td>"+
      "<td>"+t.fees+"</td>"+
      "<td>"+t.recovery+"</td>"+
      "<td>"+t.currency+"</td>"+
      "<td>"+t.destination+"</td>"+
      "<td>"+(t.retired?"Retiré":"Non")+"</td>"+
      "<td>"+
      "<button class='edit' onclick='edit(\""+t._id+"\")'>✏️</button>"+
      "<button class='del' onclick='del(\""+t._id+"\")'>❌</button>"+
      "<button class='ret' onclick='ret(\""+t._id+"\")'>💰</button>"+
      "<button class='print' onclick='printT(\""+t._id+"\")'>🖨</button>"+
      "</td>";
    tbody.appendChild(tr);

    if(!totals[t.destination]) totals[t.destination]={};
    if(!totals[t.destination][t.currency]) totals[t.destination][t.currency]=0;
    totals[t.destination][t.currency]+=t.recovery;
  });

  let div=document.getElementById("totaux");
  div.innerHTML="";
  for(let d in totals){
    for(let c in totals[d]){
      div.innerHTML+="<p>"+d+" / "+c+" : "+totals[d][c]+"</p>";
    }
  }
}

function create(){
  const a=prompt("Montant");
  const f=prompt("Frais");
  fetch("/api/transferts",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({amount:a,fees:f})}).then(load);
}
function edit(id){alert("Modifier "+id);}
function del(id){fetch("/api/transferts/"+id,{method:"DELETE"}).then(load);}
function ret(id){
  const m=prompt("Mode");
  fetch("/api/transferts/retirer",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({id:id,mode:m})}).then(load);
}
function printT(id){window.open("/print/"+id);}
load();
</script>
</body>
</html>
`);
});

/* ===================== API ===================== */

app.get("/api/transferts", async (req, res) => {
  const q = {};
  if (req.query.search) {
    q.$or = [
      { code: new RegExp(req.query.search, "i") },
      { sender: new RegExp(req.query.search, "i") },
      { receiver: new RegExp(req.query.search, "i") }
    ];
  }
  if (req.query.status === "retire") q.retired = true;
  if (req.query.status === "non") q.retired = false;
  res.json(await Transfert.find(q));
});

app.post("/api/transferts", allow("create"), async (req, res) => {
  const r = Number(req.body.amount) - Number(req.body.fees);
  await Transfert.create({
    code: "TR"+Date.now(),
    sender: "Client",
    receiver: "Dest",
    amount: req.body.amount,
    fees: req.body.fees,
    recovery: r,
    currency: "XOF",
    destination: "Local"
  });
  res.sendStatus(200);
});

app.delete("/api/transferts/:id", allow("delete"), async (req, res) => {
  await Transfert.findByIdAndDelete(req.params.id);
  res.sendStatus(200);
});

app.post("/api/transferts/retirer", allow("withdraw"), async (req, res) => {
  const t = await Transfert.findById(req.body.id);
  t.retired = true;
  await t.save();
  await Withdrawal.create({ transfertId: t._id, user: req.session.role, mode: req.body.mode });
  res.sendStatus(200);
});

/* ===================== PRINT ===================== */

app.get("/print/:id", async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  const pdf = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  pdf.pipe(res);
  pdf.text("Code: " + t.code);
  pdf.text("Montant: " + t.amount + " " + t.currency);
  pdf.text("Statut: " + (t.retired ? "Retiré" : "Non"));
  pdf.end();
});

/* ===================== START ===================== */

app.listen(PORT, () => console.log("OK http://localhost:" + PORT));
