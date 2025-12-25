<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Liste des transferts</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
body{margin:0;font-family:'Inter',sans-serif;background:#f4f6f9;padding:15px}
.header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:15px}
.header a{margin:5px;text-decoration:none;color:#007bff;font-weight:600}
.search-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:15px}
.search-bar input{padding:8px;border-radius:6px;border:1px solid #ccc;flex:1;min-width:120px}
.search-bar button{padding:8px 12px;border:none;border-radius:6px;background:#007bff;color:white;cursor:pointer}
.card{background:white;border-radius:10px;padding:12px;margin-bottom:10px;box-shadow:0 3px 10px rgba(0,0,0,.1)}
.card h4{margin:0 0 5px 0;color:#007bff;font-size:16px}
.card p{margin:2px 0;font-size:14px;color:#333}
.actions{margin-top:5px;display:flex;flex-wrap:wrap;gap:5px}
.actions button{padding:5px 8px;border:none;border-radius:6px;color:white;font-size:12px;cursor:pointer}
.modify{background:#28a745}.delete{background:#dc3545}.print{background:#17a2b8}.retirer{background:#007bff}
@media(max-width:600px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="header">
<h1>Liste des transferts</h1>
<div>
<a href="/transferts/form">➕ Nouveau</a>
<a href="/transferts/pdf">📄 PDF</a>
<a href="/transferts/excel">📊 Excel</a>
<a href="/menu">⬅ Menu</a>
</div>
</div>

<form class="search-bar" method="get">
<input name="searchPhone" placeholder="Téléphone" value="${req.query.searchPhone||''}">
<input name="searchCode" placeholder="Code" value="${req.query.searchCode||''}">
<input name="searchName" placeholder="Nom destinataire" value="${req.query.searchName||''}">
<button>🔍 Rechercher</button>
</form>

${Object.keys(grouped).map(dest=>`
<h3>${dest}</h3>
${grouped[dest].map(t=>`
<div class="card">
<h4>Code: ${t.code}</h4>
<p><b>Expéditeur:</b> ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
<p><b>Destinataire:</b> ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
<p><b>Montant:</b> ${t.amount} ${t.currency} | <b>Reçu:</b> ${t.recoveryAmount}</p>
<p><b>Statut:</b> ${t.retired?'Retiré':'Non retiré'}</p>
<p><b>Historique:</b><br>${t.retraitHistory.map(h=>`${new Date(h.date).toLocaleString()} (${h.mode})`).join('<br>')||'-'}</p>
<div class="actions">
<a href="/transferts/form?code=${t.code}"><button class="modify">✏️ Modifier</button></a>
<a href="/transferts/delete/${t._id}" onclick="return confirm('Supprimer ?')"><button class="delete">❌</button></a>
<a href="/transferts/print/${t._id}" target="_blank"><button class="print">🖨️</button></a>
${!t.retired?`<form method="post" action="/transferts/retirer" style="display:inline">
<input type="hidden" name="id" value="${t._id}">
<select name="mode"><option>Espèces</option><option>Orange Money</option><option>Wave</option><option>Produit</option><option>Service</option></select>
<button class="retirer">Retirer</button></form>`:''}
</div>
</div>`).join('')}
`).join('')}

<div style="text-align:center;margin-top:10px">
${page>1?`<a href="?page=${page-1}">⬅ Précédent</a>`:''} Page ${page}/${totalPages} ${page<totalPages?`<a href="?page=${page+1}">Suivant ➡</a>`:''}
</div>
</body>
</html>
