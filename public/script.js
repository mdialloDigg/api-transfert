function confirmDelete(url){
  if(confirm('❌ Confirmer la suppression ?')) window.location.href = url;
}

function retirer(id){
  const mode = prompt('Mode de retrait: Espèces, Orange Money, Wave, Produit, Service');
  if(mode){
    fetch('/transferts/retirer', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:`id=${id}&mode=${mode}`
    }).then(()=>location.reload());
  }
}
