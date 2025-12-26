<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Liste des transferts</title>
<style>
body { font-family: Arial; margin: 10px; background: #f4f6f9; }
h2 { color: #2c7be5; text-align: center; margin-bottom: 15px; }
.table-container { width:100%; overflow-x:auto; max-height:80vh; border:1px solid #ccc; border-radius:5px; background:#fff; position:relative; }
table { width:100%; border-collapse: collapse; min-width:900px; }
th, td { border:1px solid #ccc; padding:8px; text-align:left; font-size:14px; cursor:pointer; }
th { background:#007bff; color:white; position: sticky; top:0; z-index:2; }
.retired { background:#fff3b0; }
button, a.button { padding:6px 10px; border:none; border-radius:5px; color:white; text-decoration:none; font-size:12px; cursor:pointer; margin-right:3px;}
.modify{background:#28a745;}
.delete{background:#dc3545;}
.retirer{background:#ff9900;}
.imprimer{background:#17a2b8;}
.export{background:#6c757d;}
#filters { display:flex; flex-wrap: wrap; gap:10px; margin-bottom:10px; }
#filters input, #filters select { padding:6px; border-radius:5px; border:1px solid #ccc; font-size:14px; }
#loadingSpinner { display:none; position:absolute; top:50%; left:50%; transform: translate(-50%, -50%); width:40px; height:40px; border:5px solid #ccc; border-top:5px solid #007bff; border-radius:50%; animation: spin 1s linear infinite; }
@keyframes spin { 0% { transform: translate(-50%, -50%) rotate(0deg);} 100% { transform: translate(-50%, -50%) rotate(360deg);} }
.fade-in { animation: fadeIn 0.6s ease forwards; opacity: 0; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
th.sort-asc::after { content: " ▲"; }
th.sort-desc::after { content: " ▼"; }
@media (max-width:768px){
  td { display:flex; justify-content:space-between; padding:6px; border-bottom:1px solid #ccc; }
  td button, td a.button { margin-left:5px; margin-top:0; flex-shrink:0; }
  td::before { content: attr(data-label); font-weight:bold; flex:1; }
}
</style>
</head>
<body>

<h2>📋 Liste des transferts</h2>

<div id="filters">
  <input id="searchInput" placeholder="Recherche...">
  <select id="statusSelect">
    <option value="all">Tous</option>
    <option value="retire">Retirés</option>
    <option value="non">Non retirés</option>
  </select>
  <select id="currencySelect">
    <option value="">Toutes devises</option>
    <option value="GNF">GNF</option>
    <option value="EUR">EUR</option>
    <option value="USD">USD</option>
    <option value="XOF">XOF</option>
  </select>
  <select id="destinationSelect">
    <option value="">Toutes destinations</option>
    <option value="France">France</option>
    <option value="Belgique">Belgique</option>
    <option value="Conakry">Conakry</option>
    <option value="Suisse">Suisse</option>
    <option value="Atlanta">Atlanta</option>
    <option value="New York">New York</option>
    <option value="Allemagne">Allemagne</option>
  </select>
  <a href="/transferts/form" class="button modify">➕ Nouveau</a>
  <a href="/transferts/pdf" class="button export">📄 PDF</a>
  <a href="/transferts/excel" class="button export">📊 Excel</a>
  <a href="/transferts/word" class="button export">📝 Word</a>
  <a href="/logout" class="button delete">🚪 Déconnexion</a>
</div>

<div class="table-container">
  <div id="loadingSpinner"></div>
  <table>
    <thead>
      <tr>
        <th data-key="code">Code</th>
        <th data-key="userType">Type</th>
        <th data-key="senderFirstName">Expéditeur</th>
        <th data-key="originLocation">Origine</th>
        <th data-key="receiverFirstName">Destinataire</th>
        <th data-key="amount">Montant</th>
        <th data-key="fees">Frais</th>
        <th data-key="recoveryAmount">Reçu</th>
        <th data-key="currency">Devise</th>
        <th data-key="retired">Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="transfertsBody"></tbody>
  </table>
</div>

<div id="pagination" style="margin-top:10px;"></div>

<script>
let currentSort = {key:'', order:''};
let currentPage = 1;
const refreshInterval = 10000; // 10 secondes

function showSpinner(show){
  document.getElementById('loadingSpinner').style.display = show ? 'block' : 'none';
}

async function loadTransferts(page=1){
  currentPage = page;
  showSpinner(true);
  const search = document.getElementById('searchInput').value;
  const status = document.getElementById('statusSelect').value;
  const currency = document.getElementById('currencySelect').value;
  const destination = document.getElementById('destinationSelect').value;

  try {
    let url = `/transferts/list?search=${search}&status=${status}&currency=${currency}&destination=${destination}&page=${page}&ajax=1`;
    if(currentSort.key) url += `&sortKey=${currentSort.key}&sortOrder=${currentSort.order}`;
    const res = await fetch(url);
    const data = await res.json();

    const tbody = document.getElementById('transfertsBody');
    tbody.innerHTML = '';
    data.transferts.forEach((t,index)=>{
      const tr = document.createElement('tr');
      if(t.retired) tr.classList.add('retired');
      tr.classList.add('fade-in');

      tr.innerHTML = `
        <td data-label="Code">${t.code}</td>
        <td data-label="Type">${t.userType}</td>
        <td data-label="Expéditeur">${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</td>
        <td data-label="Origine">${t.originLocation}</td>
        <td data-label="Destinataire">${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</td>
        <td data-label="Montant">${t.amount}</td>
        <td data-label="Frais">${t.fees}</td>
        <td data-label="Reçu">${t.recoveryAmount}</td>
        <td data-label="Devise">${t.currency}</td>
        <td data-label="Status">${t.retired?'Retiré':'Non retiré'}</td>
        <td data-label="Actions">
          <a href="/transferts/form?code=${t.code}" class="button modify">✏️</a>
          <a href="/transferts/delete/${t._id}" onclick="return confirm('❌ Confirmer?');" class="button delete">❌</a>
          ${!t.retired ? `<form method="post" action="/transferts/retirer" style="display:inline">
            <input type="hidden" name="id" value="${t._id}">
            <select name="mode">
              <option>Espèces</option><option>Orange Money</option><option>Wave</option>
            </select>
            <button type="submit" class="button retirer">💰</button>
          </form>` : ''}
          <a href="/transferts/print/${t._id}" target="_blank" class="button imprimer">🖨</a>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Pagination
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    for(let i=1;i<=data.totalPages;i++){
      const a = document.createElement('a');
      a.href="#";
      a.textContent = i;
      if(i===currentPage) a.style.fontWeight='bold';
      a.onclick = (e)=>{ e.preventDefault(); loadTransferts(i); };
      pagination.appendChild(a);
      pagination.appendChild(document.createTextNode(' '));
    }

    // Tri visuel
    document.querySelectorAll('th[data-key]').forEach(th=>{
      th.classList.remove('sort-asc','sort-desc');
      if(th.dataset.key === currentSort.key) th.classList.add(currentSort.order==='asc'?'sort-asc':'sort-desc');
    });

  } catch (err) { console.error('Erreur AJAX:', err); }
  finally { showSpinner(false); }
}

// Tri
document.querySelectorAll('th[data-key]').forEach(th=>{
  th.addEventListener('click',()=>{
    if(currentSort.key===th.dataset.key) currentSort.order = currentSort.order==='asc'?'desc':'asc';
    else { currentSort.key = th.dataset.key; currentSort.order = 'asc'; }
    loadTransferts(currentPage);
  });
});

// Filtres
['searchInput','statusSelect','currencySelect','destinationSelect'].forEach(id=>{
  const el = document.getElementById(id);
  el.addEventListener('input', ()=>loadTransferts(1));
  el.addEventListener('change', ()=>loadTransferts(1));
});

// Chargement initial
loadTransferts();

// Rafraîchissement automatique
setInterval(() => loadTransferts(currentPage), refreshInterval);
</script>

</body>
</html>
