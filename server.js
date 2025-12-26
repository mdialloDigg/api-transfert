// server.js
const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient, ObjectId } = require("mongodb");
const XLSX = require("xlsx");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB setup
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
let db, transfers;

async function connectDB() {
  await client.connect();
  db = client.db("transfertDB");
  transfers = db.collection("transferts");
}
connectDB().catch(console.error);

// Session simple
let currentUser = null;

// Login simple
app.get("/login/:user", (req,res)=>{
  const user=req.params.user;
  if(user==="a" || user==="admin2"){
    currentUser={username:user, role:user};
    res.redirect("/transferts");
  } else res.send("Utilisateur inconnu");
});

app.get("/logout",(req,res)=>{
  currentUser=null;
  res.redirect("/login/a");
});

// Page principale
app.get("/transferts", async (req,res)=>{
  if(!currentUser) return res.redirect("/login/a");
  const destinations = await transfers.distinct("destinationLocation");
  const currencies = await transfers.distinct("currency");

  let optionsLocation = destinations.map(d=>`<option value="${d}">${d}</option>`).join("");
  let optionsCurrency = currencies.map(c=>`<option value="${c}">${c}</option>`).join("");

  res.send(`
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
      .excel{background:#17a2b8;}
      .word{background:#6f42c1;}
      @media(max-width:600px){table, th, td{font-size:12px;} button{padding:3px 5px;}}
      .modal{display:none;position:fixed;z-index:1;padding-top:100px;left:0;top:0;width:100%;height:100%;overflow:auto;background:rgba(0,0,0,0.4);}
      .modal-content{background:#fefefe;margin:auto;padding:20px;border:1px solid #888;width:90%;max-width:500px;}
      .close{color:#aaa;float:right;font-size:28px;font-weight:bold;cursor:pointer;}
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
      <select id="destination"><option value="">Toutes destinations</option>${optionsLocation}</select>
      <button onclick="loadData()">🔍 Filtrer</button>
      <a href="/logout">🚪 Déconnexion</a>
      <button onclick="openModal('create')">➕ Nouveau transfert</button>
      <button onclick="exportExcel()" class="excel">📊 Excel</button>
      <button onclick="exportWord()" class="word">📝 Word</button>
      <table>
        <thead>
          <tr>
            <th>Code</th><th>Type</th><th>Expéditeur</th><th>Origine</th><th>Destinataire</th>
            <th>Montant</th><th>Frais</th><th>Reçu</th><th>Devise</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <h3>📊 Totaux par destination et devise</h3>
      <div id="totaux"></div>
    </div>

    <!-- Modal -->
    <div id="modal" class="modal">
      <div class="modal-content">
        <span class="close" onclick="closeModal()">&times;</span>
        <h3 id="modalTitle">Nouveau transfert</h3>
        <form id="transferForm">
          <input name="code" placeholder="Code" required><br><br>
          <input name="userType" placeholder="Type" required><br><br>
          <input name="senderFirstName" placeholder="Prénom expéditeur" required><br><br>
          <input name="senderLastName" placeholder="Nom expéditeur" required><br><br>
          <input name="senderPhone" placeholder="Téléphone expéditeur" required><br><br>
          <input name="originLocation" placeholder="Origine" required><br><br>
          <input name="receiverFirstName" placeholder="Prénom destinataire" required><br><br>
          <input name="receiverLastName" placeholder="Nom destinataire" required><br><br>
          <input name="receiverPhone" placeholder="Téléphone destinataire" required><br><br>
          <input name="amount" placeholder="Montant" type="number" step="0.01" required><br><br>
          <input name="fees" placeholder="Frais" type="number" step="0.01" required><br><br>
          <input name="currency" placeholder="Devise" required><br><br>
          <input name="destinationLocation" placeholder="Destination" required><br><br>
          <input type="hidden" name="id">
          <button type="submit">Enregistrer</button>
        </form>
      </div>
    </div>

    <script>
      const role = "${currentUser.role}";

      async function loadData() {
        const search = encodeURIComponent(document.getElementById("search").value);
        const status = encodeURIComponent(document.getElementById("status").value);
        const currency = encodeURIComponent(document.getElementById("currency").value);
        const destination = encodeURIComponent(document.getElementById("destination").value);

        const res = await fetch(\`/transferts/data?search=\${search}&status=\${status}&currency=\${currency}&destination=\${destination}\`);
        const data = await res.json();

        const tbody = document.getElementById("tbody");
        tbody.innerHTML = "";
        const totals = {};

        data.forEach(t => {
          const tr = document.createElement("tr");
          if(t.retired) tr.className="retired";

          let actions = '';
          if(role!=='a') actions += '<button class="modify" onclick="openModal(\'edit\',\\''+t._id+'\\')">✏️</button>';
          if(role!=='a') actions += '<button class="delete" onclick="removeTransfer(\\''+t._id+'\\')">❌</button>';
          if(role==='a') actions += '<button class="retirer" onclick="retirer(\\''+t._id+'\\')">💰</button>';
          actions += '<button class="imprimer" onclick="imprimer(\\''+t._id+'\\')">🖨</button>';

          tr.innerHTML = \`
            <td>\${t.code}</td><td>\${t.userType}</td><td>\${t.senderFirstName} \${t.senderLastName} (\${t.senderPhone})</td>
            <td>\${t.originLocation}</td><td>\${t.receiverFirstName} \${t.receiverLastName} (\${t.receiverPhone})</td>
            <td>\${t.amount}</td><td>\${t.fees}</td><td>\${t.recoveryAmount}</td>
            <td>\${t.currency}</td><td>\${t.retired?"Retiré":"Non retiré"}</td><td>\${actions}</td>
          \`;
          tbody.appendChild(tr);

          if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
          if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0,fees:0,recovery:0};
          totals[t.destinationLocation][t.currency].amount += t.amount;
          totals[t.destinationLocation][t.currency].fees += t.fees;
          totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
        });

        const divtot = document.getElementById("totaux");
        divtot.innerHTML = "";
        for(let dest in totals){
          for(let curr in totals[dest]){
            divtot.innerHTML += "<p>"+dest+" | "+curr+" : Montant="+totals[dest][curr].amount+", Frais="+totals[dest][curr].fees+", Reçu="+totals[dest][curr].recovery+"</p>";
          }
        }
      }

      function openModal(mode,id=null){
        document.getElementById("modal").style.display="block";
        const form = document.getElementById("transferForm");
        form.reset();
        form.id.value = '';
        document.getElementById("modalTitle").innerText = mode==='create'?'Nouveau transfert':'Modifier transfert';
        if(mode==='edit' && id){
          fetch('/transferts/data/'+id).then(res=>res.json()).then(t=>{
            for(let key in t) if(form[key]) form[key].value=t[key];
          });
        }
      }
      function closeModal(){ document.getElementById("modal").style.display="none"; }

      document.getElementById("transferForm").addEventListener("submit", async e=>{
        e.preventDefault();
        const formData = new FormData(e.target);
        const obj = {};
        formData.forEach((v,k)=> obj[k]=v);
        obj.amount=parseFloat(obj.amount); obj.fees=parseFloat(obj.fees);
        obj.recoveryAmount = obj.amount - obj.fees;

        const method = obj.id?'PUT':'POST';
        const url = obj.id?'/transferts/edit/'+obj.id:'/transferts/create';
        await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
        closeModal(); loadData();
      });

      function removeTransfer(id){ fetch('/transferts/delete/'+id,{method:'DELETE'}).then(loadData); }
      function retirer(id){ if(role!=='a') return alert("Interdit"); const mode=prompt("Mode de retrait"); if(mode) fetch('/transferts/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,mode})}).then(loadData); }
      function imprimer(id){ window.open('/transferts/print/'+id,'_blank'); }
      function exportExcel(){ window.location='/transferts/excel'; }
      function exportWord(){ window.location='/transferts/word'; }

      window.onclick = function(event){ if(event.target==document.getElementById("modal")) closeModal(); }
      window.onload = loadData;
    </script>
  </body>
  </html>
  `);
});

// API
app.get("/transferts/data", async (req,res)=>{
  const { search,status,currency,destination } = req.query;
  const query = {};
  if(search) query.code={$regex:search,$options:"i"};
  if(status==='retire') query.retired=true;
  if(status==='non') query.retired=false;
  if(currency) query.currency=currency;
  if(destination) query.destinationLocation=destination;
  const data = await transfers.find(query).toArray();
  res.json(data);
});

app.get("/transferts/data/:id", async (req,res)=>{
  const t = await transfers.findOne({_id:ObjectId(req.params.id)});
  res.json(t);
});

app.post("/transferts/create", async (req,res)=>{
  const t = {...req.body, retired:false};
  await transfers.insertOne(t);
  res.sendStatus(200);
});

app.put("/transferts/edit/:id", async (req,res)=>{
  const t = {...req.body};
  await transfers.updateOne({_id:ObjectId(req.params.id)},{$set:t});
  res.sendStatus(200);
});

app.delete("/transferts/delete/:id", async (req,res)=>{
  if(currentUser.role==='a') return res.sendStatus(403);
  await transfers.deleteOne({_id:ObjectId(req.params.id)});
  res.sendStatus(200);
});

app.post("/transferts/retirer", async (req,res)=>{
  if(currentUser.role!=='a') return res.sendStatus(403);
  await transfers.updateOne({_id:ObjectId(req.body.id)},{$set:{retired:true,mode:req.body.mode}});
  res.sendStatus(200);
});

app.get("/transferts/print/:id", async (req,res)=>{
  const t = await transfers.findOne({_id:ObjectId(req.params.id)});
  if(!t) return res.send("Transfert introuvable");
  res.send(`<pre>${JSON.stringify(t,null,2)}</pre>`);
});

// Export Excel
app.get("/transferts/excel", async (req,res)=>{
  const data = await transfers.find({}).toArray();
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transferts");
  const file = path.join(__dirname,"transferts.xlsx");
  XLSX.writeFile(wb, file);
  res.download(file, ()=>fs.unlinkSync(file));
});

// Export Word
app.get("/transferts/word", async (req,res)=>{
  const data = await transfers.find({}).toArray();
  const doc = new Document();
  data.forEach(t=>{
    doc.addSection({children:[new Paragraph({children:[new TextRun(\`Code: ${t.code} | Expéditeur: ${t.senderFirstName} ${t.senderLastName} | Destinataire: ${t.receiverFirstName} ${t.receiverLastName} | Montant: ${t.amount} ${t.currency} | Status: ${t.retired?'Retiré':'Non retiré'}\`)])}]});
  });
  const buffer = await Packer.toBuffer(doc);
  const file = path.join(__dirname,"transferts.docx");
  fs.writeFileSync(file, buffer);
  res.download(file, ()=>fs.unlinkSync(file));
});

app.listen(port, ()=>console.log(`Server running on port ${port}`));
