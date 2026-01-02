// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const app = express();
const PORT = 3000;

// --- MongoDB ---
const MONGODB_URI = 'mongodb://127.0.0.1:27017/stockdb'; // <- Change si nécessaire
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log('MongoDB connecté'))
  .catch(err=>console.error('Erreur MongoDB', err));

// --- Modèle Stock ---
const stockSchema = new mongoose.Schema({
  sender: String,
  destination: String,
  amount: Number,
  currency: String
});
const Stock = mongoose.model('Stock', stockSchema);

// --- Middlewares ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- Page principale avec HTML + JS intégré ---
app.get('/', async (req, res) => {
  const stocks = await Stock.find();
  let stockRows = stocks.map(s => `
    <tr data-id="${s._id}">
      <td><input value="${s.sender}"></td>
      <td><input value="${s.destination}"></td>
      <td><input value="${s.amount}"></td>
      <td><input value="${s.currency}"></td>
      <td>
        <button class="modifyBtn">Modifier</button>
        <button class="deleteBtn">Supprimer</button>
      </td>
    </tr>
  `).join('');

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Stocks</title>
    <style>
      table, input { border: 1px solid #ccc; padding: 5px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; }
    </style>
  </head>
  <body>
    <h2>Stocks</h2>
    <table id="stockTable">
      <thead>
        <tr><th>Sender</th><th>Destination</th><th>Amount</th><th>Currency</th><th>Actions</th></tr>
      </thead>
      <tbody>${stockRows}</tbody>
    </table>

    <h3>Ajouter un stock</h3>
    <div id="newStocks"></div>
    <button id="addRowBtn">+ Ligne</button>
    <button id="submitStocksBtn">Ajouter Stocks</button>

    <script>
      const newStocksDiv = document.getElementById('newStocks');
      const addRowBtn = document.getElementById('addRowBtn');
      const submitStocksBtn = document.getElementById('submitStocksBtn');
      const stockTable = document.getElementById('stockTable').querySelector('tbody');

      addRowBtn.onclick = () => {
        const div = document.createElement('div');
        div.style.marginBottom = '5px';
        div.innerHTML = \`
          <input name="sender" placeholder="Sender">
          <input name="destination" placeholder="Destination">
          <input name="amount" placeholder="Amount">
          <input name="currency" placeholder="Currency">
          <button type="button">Supprimer</button>
        \`;
        div.querySelector('button').onclick = () => div.remove();
        newStocksDiv.appendChild(div);
      };

      submitStocksBtn.onclick = async () => {
        const divs = [...newStocksDiv.children];
        if(divs.length === 0) return alert('Aucune ligne à ajouter');

        const stocksData = divs.map(d=>({
          sender: d.querySelector('input[name="sender"]').value,
          destination: d.querySelector('input[name="destination"]').value,
          amount: parseFloat(d.querySelector('input[name="amount"]').value),
          currency: d.querySelector('input[name="currency"]').value
        }));

        const res = await fetch('/transferts/stock/multi',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({stocks: stocksData})
        });
        const data = await res.json();
        alert(data.message);
        if(!data.ok) return;

        data.addedStocks.forEach(s => {
          const tr = document.createElement('tr');
          tr.dataset.id = s._id;
          tr.innerHTML = \`
            <td><input value="\${s.sender}"></td>
            <td><input value="\${s.destination}"></td>
            <td><input value="\${s.amount}"></td>
            <td><input value="\${s.currency}"></td>
            <td>
              <button class="modifyBtn">Modifier</button>
              <button class="deleteBtn">Supprimer</button>
            </td>
          \`;
          stockTable.prepend(tr);
          attachRowEvents(tr);
        });
        newStocksDiv.innerHTML = '';
      };

      function attachRowEvents(tr){
        const id = tr.dataset.id;
        tr.querySelector('.modifyBtn').onclick = async () => {
          const body = {
            sender: tr.children[0].querySelector('input').value,
            destination: tr.children[1].querySelector('input').value,
            amount: parseFloat(tr.children[2].querySelector('input').value),
            currency: tr.children[3].querySelector('input').value
          };
          const res = await fetch('/transferts/stock/'+id,{
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
          });
          const data = await res.json();
          alert(data.message);
        };

        tr.querySelector('.deleteBtn').onclick = async () => {
          const res = await fetch('/transferts/stock/'+id,{ method:'DELETE' });
          const data = await res.json();
          alert(data.message);
          if(data.ok) tr.remove();
        };
      }

      document.querySelectorAll('#stockTable tbody tr').forEach(tr => attachRowEvents(tr));
    </script>
  </body>
  </html>
  `);
});

// --- API pour ajouter plusieurs stocks ---
app.post('/transferts/stock/multi', async (req,res)=>{
  const { stocks: newStocks } = req.body;
  if(!newStocks || !Array.isArray(newStocks)) return res.json({ ok:false, message:'Aucune donnée reçue' });

  try {
    const addedStocks = await Stock.insertMany(newStocks);
    res.json({ ok:true, message:'Stocks ajoutés', addedStocks });
  } catch(err){
    res.json({ ok:false, message: err.message });
  }
});

// --- API pour modifier un stock ---
app.put('/transferts/stock/:id', async (req,res)=>{
  try{
    const updated = await Stock.findByIdAndUpdate(req.params.id, req.body, { new:true });
    if(!updated) return res.json({ ok:false, message:'Stock introuvable' });
    res.json({ ok:true, message:'Stock modifié' });
  } catch(err){
    res.json({ ok:false, message: err.message });
  }
});

// --- API pour supprimer un stock ---
app.delete('/transferts/stock/:id', async (req,res)=>{
  try{
    const deleted = await Stock.findByIdAndDelete(req.params.id);
    if(!deleted) return res.json({ ok:false, message:'Stock introuvable' });
    res.json({ ok:true, message:'Stock supprimé' });
  } catch(err){
    res.json({ ok:false, message: err.message });
  }
});

// --- Lancer le serveur ---
app.listen(PORT, ()=>console.log(`Server running at http://localhost:${PORT}`));
