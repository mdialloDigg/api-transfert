app.get('/dashboard', requireLogin, async(req,res)=>{
  const { search='', status='all' } = req.query;
  const transfertsRaw = await Transfert.find().sort({createdAt:-1});
  const stocks = await Stock.find().sort({createdAt:-1});
  const stockHistory = await StockHistory.find().sort({date:-1});

  // Filtrage recherche
  const s = search.toLowerCase();
  let transferts = transfertsRaw.filter(t=>{
    return t.code.toLowerCase().includes(s)
      || t.senderFirstName.toLowerCase().includes(s)
      || t.senderLastName.toLowerCase().includes(s)
      || t.senderPhone.toLowerCase().includes(s)
      || t.receiverFirstName.toLowerCase().includes(s)
      || t.receiverLastName.toLowerCase().includes(s)
      || t.receiverPhone.toLowerCase().includes(s);
  });
  if(status==='retire') transferts = transferts.filter(t=>t.retired);
  else if(status==='non') transferts = transferts.filter(t=>!t.retired);

  // Totaux par destination/devise
  const totals = {};
  transferts.forEach(t=>{
    if(!totals[t.destinationLocation]) totals[t.destinationLocation]={};
    if(!totals[t.destinationLocation][t.currency]) totals[t.destinationLocation][t.currency]={amount:0, fees:0, recovery:0};
    totals[t.destinationLocation][t.currency].amount += t.amount;
    totals[t.destinationLocation][t.currency].fees += t.fees;
    totals[t.destinationLocation][t.currency].recovery += t.recoveryAmount;
  });

  // HTML
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
      <option value="all" ${status==='all'?'selected':''}>Tous</option>
      <option value="retire" ${status==='retire'?'selected':''}>Retirés</option>
      <option value="non" ${status==='non'?'selected':''}>Non retirés</option>
    </select>
    <button type="submit">🔍 Filtrer</button>
    ${req.session.user.permissions.ecriture?'<button type="button" onclick="newTransfert()">➕ Nouveau Transfert</button>':'<span></span>'}
  </form>
  <h4>Totaux par destination/devise</h4>
  <table><thead><tr><th>Destination</th><th>Devise</th><th>Montant</th><th>Frais</th><th>Reçu</th></tr></thead><tbody>`;
  for(let dest in totals){
    for(let curr in totals[dest]){
      html+=`<tr><td>${dest}</td><td>${curr}</td><td>${totals[dest][curr].amount}</td><td>${totals[dest][curr].fees}</td><td>${totals[dest][curr].recovery}</td></tr>`;
    }
  }
  html+='</tbody></table>';

  // Table transferts
  html+='<table><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th></tr>';
  transferts.forEach(t=>{
    html+=`<tr data-id="${t._id}"><td>${t.code}</td><td>${t.senderFirstName}</td><td>${t.receiverFirstName}</td><td>${t.amount}</td><td>${t.currency}</td><td>${t.retired?'Retiré':'Non retiré'}</td>
    <td><button class="modify" onclick="editTransfert('${t._id}')">✏️</button><button class="delete" onclick="deleteTransfert('${t._id}')">❌</button>
    ${!t.retired?`<button class="retirer" onclick="retirerTransfert('${t._id}')">💰</button>`:''}</td></tr>`;
  });
  html+='</table>';

  // Stocks avec bouton "Nouveau Stock"
  html+=`<h3>Stocks</h3>
  ${req.session.user.permissions.ecriture?'<button type="button" onclick="newStock()">➕ Nouveau Stock</button>':''}
  <table><tr><th>Expéditeur</th><th>Destination</th><th>Montant</th><th>Actions</th></tr>`;
  stocks.forEach(s=>{
    html+=`<tr data-id="${s._id}"><td>${s.sender}</td><td>${s.destination}</td><td>${s.amount}</td><td><button onclick="editStock('${s._id}')">✏️</button><button onclick="deleteStock('${s._id}')">❌</button></td></tr>`;
  });
  html+='</table>';

  // Historique stocks
  html+='<h3>Historique Stocks</h3><table><tr><th>Date</th><th>Action</th><th>Expéditeur</th><th>Destination</th><th>Montant</th></tr>';
  stockHistory.forEach(h=>{
    html+=`<tr><td>${h.date.toLocaleString()}</td><td>${h.action}</td><td>${h.sender}</td><td>${h.destination}</td><td>${h.amount}</td></tr>`;
  });
  html+='</table>';

  // JS
  html+=`<script>
  async function postData(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());}
  
  function newTransfert(){
    const sender = prompt('Expéditeur'); const receiver = prompt('Destinataire');
    const amount = parseFloat(prompt('Montant')); const currency = prompt('Devise','GNF');
    if(sender && receiver && amount) postData('/transferts/form',{senderFirstName:sender,receiverFirstName:receiver,amount,fees:0,recoveryAmount:amount,currency,userType:'Client'}).then(()=>location.reload());
  }

  function newStock(){
    const sender = prompt('Expéditeur'); const destination = prompt('Destination');
    const amount = parseFloat(prompt('Montant')); if(sender && destination && amount) postData('/stocks/new',{sender,destination,amount}).then(()=>location.reload());
  }

  async function editTransfert(id){const t=await (await fetch('/transferts/get/'+id)).json();const code=prompt('Code',t.code)||t.code;const amount=parseFloat(prompt('Montant',t.amount))||t.amount; await postData('/transferts/form',{_id:t._id,code,amount}); location.reload();}
  async function deleteTransfert(id){if(confirm('Supprimer ?')){await postData('/transferts/delete',{id}); location.reload();}}
  async function retirerTransfert(id){const mode=prompt('Mode de retrait','Espèces'); if(mode){await postData('/transferts/retirer',{id,mode}); location.reload();}}

  async function editStock(id){const s=await (await fetch('/stocks/get/'+id)).json();const sender=prompt('Expéditeur',s.sender)||s.sender;const destination=prompt('Destination',s.destination)||s.destination;const amount=parseFloat(prompt('Montant',s.amount))||s.amount;await postData('/stocks/new',{_id:s._id,sender,destination,amount}); location.reload();}
  async function deleteStock(id){if(confirm('Supprimer stock ?')){await postData('/stocks/delete',{id}); location.reload();}}
  </script>`;

  html+='</body></html>';
  res.send(html);
});
