// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient, ObjectId } = require("mongodb");
const XLSX = require("xlsx");
const { Document, Packer, Paragraph, TextRun } = require("docx");

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
let db, transferts;
async function connectDB() {
  await client.connect();
  db = client.db("transfertDB");
  transferts = db.collection("transferts");
}
connectDB();

// Middleware utilisateur (simulé)
const currentUser = { username: "admin", role: "admin" }; // admin2, retirer

// ROUTE PRINCIPALE
app.get("/transferts", async (req, res) => {
  const destinations = await transferts.distinct("destinationLocation");
  const currencies = await transferts.distinct("currency");

  const optionsDestination = destinations.map(d=>`<option value="${d}">${d}</option>`).join("");
  const optionsCurrency = currencies.map(c=>`<option value="${c}">${c}</option>`).join("");

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
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
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);}
.modal-content{background:white;padding:20px;margin:50px auto;width:90%;max-width:500px;border-radius:8px;}
</style>
</head>
<body>
<h2>📋 Liste des transferts</h2>
<div>
<input id="search" placeholder="Recherche...">
<select id="status">
  <option value="all">Tous</option>
  <option value="retire">Retirés</option>
  <option value="non">Non retirés</option>
</select>
<select id="currency"><option value="">Toutes devises</option>${optionsCurrency}</select>
<select id="destination"><option value="">Toutes destinations</option>${optionsDestination}</select>
<button onclick="loadData()">🔍 Filtrer</button>
<button onclick="openModal()">➕ Nouveau</button>
<button onclick="exportExcel()">📊 Excel</button>
<button onclick="exportWord()">📝 Word</button>
<table>
<thead>
<tr><th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th><th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th></tr>
</thead>
<tbody id="tbody"></tbody>
</table>
<h3>📊 Totaux par destination et devise</h3>
<div id="totaux"></div>
</div>

<div id="modal" class="modal">
<div class="modal-content">
<h3 id="modalTitle"></h3>
<input type="hidden" id="editId">
<label>Code:</label><input id="newCode"><br>
<label>Type:</label><input id="newType"><br>
<label>Expéditeur:</label><input id="newSender"><br>
<label>Origine:</label><input id="newOrigin"><br>
<label>Destinataire:</label><input id="newReceiver"><br>
<label>Montant:</label><input id="newAmount" type="number"><br>
<label>Frais:</label><input id="newFees" type="number"><br>
<label>Reçu:</label><input id="newRecovery" type="number" readonly><br>
<label>Devise:</label><input id="newCurrency"><br>
<label>Destination:</label><input id="newDestination"><br>
<button onclick="saveTransfer()">💾 Enregistrer</button>
<button onclick="closeModal()">❌ Fermer</button>
</div>
</div>

<script>
const currentUserRole = "${currentUser.role}";

async function loadData(){
  const search=document.getElementById("search").value;
  const status=document.getElementById("status").value;
  const currency=document.getElementById("currency").value;
  const destination=document.getElementById("destination").value;
  const resp=await fetch("/transferts/data?search="+encodeURIComponent(search)+
                         "&status="+encodeURIComponent(status)+
                         "&currency="+encodeURIComponent(currency)+
                         "&destination="+encodeURIComponent(destination));
  const data=await resp.json();
  const tbody=document.getElementById("tbody");
  tbody.innerHTML="";
  const totals={};
  data.forEach(t=>{
    const tr=document.createElement("tr");
    if(t.retired) tr.className="retired";
    let actions="";
    if(currentUserRole==="admin2" || currentUserRole==="admin"){
      actions+=\`<button class='modify' onclick='openEdit("\${t._id}")'>✏️</button>\`;
      actions+=\`<button class='delete' onclick='remove("\${t._id}")'>❌</button>\`;
    }
    if(currentUserRole==="retirer" || currentUserRole==="admin"){
      actions+=\`<button class='retirer' onclick='retirer("\${t._id}")'>💰</button>\`;
    }
    actions+=\`<button class='imprimer' onclick='imprimer("\${t._id}")'>🖨</button>\`;
    tr.innerHTML="<td>"+t.code+"</td>"+
                 "<td>"+t.userType+"</td>"+
                 "<td>"+t.senderFirstName+" "+t.senderLastName+" ("+t.senderPhone+")</td>"+
                 "<td>"+t.originLocation+"</td>"+
                 "<td>"+t.receiverFirstName+" "+t.receiverLastName+" ("+t.receiverPhone+")</td>"+
                 "<td>"+t.amount+"</td>"+
                 "<td>"+t.fees+"</td>"+
                 "<td>"+t.recoveryAmount+"</td>"+
                 "<td>"+t.currency+"</td>"+
                 "<td>"+(t.retired?"Retiré":"Non retiré")+"</td>"+
                 "<td>"+actions+"</td>";
    tbody.appendChild(tr);

    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
    totals[t.destinationLocation][t.currency].amount+=t.amount;
    totals[t.destinationLocation][t.currency].fees+=t.fees;
    totals[t.destinationLocation][t.currency].recovery+=t.recoveryAmount;
  });

  const divtot=document.getElementById("totaux");
  divtot.innerHTML="";
  for(const dest in totals){
    for(const curr in totals[dest]){
      divtot.innerHTML+="<p>"+dest+" | "+curr+" : Montant="+totals[dest][curr].amount+
                        ", Frais="+totals[dest][curr].fees+
                        ", Reçu="+totals[dest][curr].recovery+"</p>";
    }
  }
}

// Modal et calcul automatique
function openModal(){ 
  document.getElementById("modalTitle").innerText="Nouveau Transfert";
  document.getElementById("editId").value="";
  document.querySelectorAll("#modal input").forEach(i=>i.value="");
  document.getElementById("modal").style.display="block"; 
}
function closeModal(){ document.getElementById("modal").style.display="none"; }
document.getElementById("newAmount").addEventListener("input", updateRecovery);
document.getElementById("newFees").addEventListener("input", updateRecovery);
function updateRecovery(){
  const amount=parseFloat(document.getElementById("newAmount").value)||0;
  const fees=parseFloat(document.getElementById("newFees").value)||0;
  document.getElementById("newRecovery").value=(amount-fees).toFixed(2);
}

// Edit
async function openEdit(id){
  const resp=await fetch("/transferts/data?id="+id);
  const t=await resp.json();
  if(!t[0]) return alert("Introuvable");
  const tr=t[0];
  document.getElementById("modalTitle").innerText="Modifier Transfert";
  document.getElementById("editId").value=tr._id;
  document.getElementById("newCode").value=tr.code;
  document.getElementById("newType").value=tr.userType;
  document.getElementById("newSender").value=tr.senderFirstName;
  document.getElementById("newOrigin").value=tr.originLocation;
  document.getElementById("newReceiver").value=tr.receiverFirstName;
  document.getElementById("newAmount").value=tr.amount;
  document.getElementById("newFees").value=tr.fees;
  document.getElementById("newRecovery").value=tr.recoveryAmount;
  document.getElementById("newCurrency").value=tr.currency;
  document.getElementById("newDestination").value=tr.destinationLocation;
  document.getElementById("modal").style.display="block";
}

// Save
async function saveTransfer(){
  const id=document.getElementById("editId").value;
  const data={
    code: document.getElementById("newCode").value,
    userType: document.getElementById("newType").value,
    senderFirstName: document.getElementById("newSender").value,
    originLocation: document.getElementById("newOrigin").value,
    receiverFirstName: document.getElementById("newReceiver").value,
    amount: parseFloat(document.getElementById("newAmount").value),
    fees: parseFloat(document.getElementById("newFees").value),
    recoveryAmount: parseFloat(document.getElementById("newRecovery").value),
    currency: document.getElementById("newCurrency").value,
    destinationLocation: document.getElementById("newDestination").value
  };
  if(id){
    await fetch("/transferts/edit/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  } else {
    await fetch("/transferts/new",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  }
  closeModal();
  loadData();
}

// Delete
function remove(id){ fetch("/transferts/delete/"+id,{method:"DELETE"}).then(loadData); }

// Retirer
function retirer(id){ 
  const mode=prompt("Mode de retrait: Espèces, Orange Money, Wave");
  if(mode) fetch("/transferts/retirer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,mode})}).then(loadData); 
}

// Imprimer
function imprimer(id){ window.open("/transferts/print/"+id,"_blank"); }

// Export Excel
function exportExcel(){
  const search=document.getElementById("search").value;
  const status=document.getElementById("status").value;
  const currency=document.getElementById("currency").value;
  const destination=document.getElementById("destination").value;
  window.location.href="/transferts/excel?search="+encodeURIComponent(search)+
                         "&status="+encodeURIComponent(status)+
                         "&currency="+encodeURIComponent(currency)+
                         "&destination="+encodeURIComponent(destination);
}

// Export Word
function exportWord(){
  const search=document.getElementById("search").value;
  const status=document.getElementById("status").value;
  const currency=document.getElementById("currency").value;
  const destination=document.getElementById("destination").value;
  window.location.href="/transferts/word?search="+encodeURIComponent(search)+
                         "&status="+encodeURIComponent(status)+
                         "&currency="+encodeURIComponent(currency)+
                         "&destination="+encodeURIComponent(destination);
}

window.onload=loadData;
</script>
</body>
</html>
  `);
});

// API DATA
app.get("/transferts/data", async (req,res)=>{
  const q={};
  if(req.query.id) q._id=ObjectId(req.query.id);
  if(req.query.search) q.code={$regex:req.query.search,$options:"i"};
  if(req.query.status==="retire") q.retired=true;
  if(req.query.status==="non") q.retired=false;
  if(req.query.currency) q.currency=req.query.currency;
  if(req.query.destination) q.destinationLocation=req.query.destination;
  const data=await transferts.find(q).toArray();
  res.json(data);
});

// CREATE
app.post("/transferts/new", async (req,res)=>{
  const t=req.body;
  t.retired=false;
  await transferts.insertOne(t);
  res.sendStatus(200);
});

// EDIT
app.put("/transferts/edit/:id", async (req,res)=>{
  await transferts.updateOne({_id:ObjectId(req.params.id)},{$set:req.body});
  res.sendStatus(200);
});

// DELETE
app.delete("/transferts/delete/:id", async (req,res)=>{
  await transferts.deleteOne({_id:ObjectId(req.params.id)});
  res.sendStatus(200);
});

// RETIRER
app.post("/transferts/retirer", async (req,res)=>{
  await transferts.updateOne({_id:ObjectId(req.body.id)},{$set:{retired:true,mode:req.body.mode}});
  res.sendStatus(200);
});

// PRINT
app.get("/transferts/print/:id", async (req,res)=>{
  const t=await transferts.findOne({_id:ObjectId(req.params.id)});
  if(!t) return res.send("Introuvable");
  res.send(`<h1>Transfert ${t.code}</h1>
            <p>Expéditeur: ${t.senderFirstName} ${t.senderLastName}</p>
            <p>Destinataire: ${t.receiverFirstName} ${t.receiverLastName}</p>
            <p>Montant: ${t.amount} ${t.currency}</p>
            <p>Status: ${t.retired?"Retiré":"Non retiré"}</p>
            <button onclick="window.print()">🖨 Imprimer</button>`);
});

// EXPORT EXCEL
app.get("/transferts/excel", async (req,res)=>{
  const q={};
  if(req.query.search) q.code={$regex:req.query.search,$options:"i"};
  if(req.query.status==="retire") q.retired=true;
  if(req.query.status==="non") q.retired=false;
  if(req.query.currency) q.currency=req.query.currency;
  if(req.query.destination) q.destinationLocation=req.query.destination;
  const data=await transferts.find(q).toArray();
  const ws=XLSX.utils.json_to_sheet(data);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Transferts");
  const buf=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
  res.setHeader("Content-Disposition","attachment; filename=transferts.xlsx");
  res.send(buf);
});

// EXPORT WORD
app.get("/transferts/word", async (req,res)=>{
  const q={};
  if(req.query.search) q.code={$regex:req.query.search,$options:"i"};
  if(req.query.status==="retire") q.retired=true;
  if(req.query.status==="non") q.retired=false;
  if(req.query.currency) q.currency=req.query.currency;
  if(req.query.destination) q.destinationLocation=req.query.destination;
  const data=await transferts.find(q).toArray();
  const doc = new Document();
  data.forEach(t=>{
    doc.addSection({
      children:[
        new Paragraph({
          children:[
            new TextRun(`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Status: ${t.retired?'Retiré':'Non retiré'}`)
          ]
        })
      ]
    });
  });
  const b64 = await Packer.toBase64String(doc);
  res.setHeader("Content-Disposition","attachment; filename=transferts.docx");
  res.send(Buffer.from(b64,"base64"));
});

// SERVER
app.listen(3000,()=>console.log("Server running on http://localhost:3000/transferts"));
