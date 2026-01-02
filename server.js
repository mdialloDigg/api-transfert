/******************************************************************
 * APP TRANSFERT + STOCK – STABLE / AJAX / MOBILE / RENDER READY
 ******************************************************************/
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/stockDB';

/* ---------------- MIDDLEWARE ---------------- */
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended:true }));
app.use(session({ secret:'secret', resave:false, saveUninitialized:true }));

/* ---------------- MONGODB ---------------- */
mongoose.connect(MONGO_URI)
  .then(()=>console.log('MongoDB OK'))
  .catch(err=>console.error(err));

/* ---------------- SCHEMAS ---------------- */
const Stock = mongoose.model('Stock', new mongoose.Schema({
  sender:String,
  destination:String,
  amount:Number,
  currency:String,
  createdAt:{ type:Date, default:Date.now }
}));

/* ---------------- LOGIN SIMPLE ---------------- */
app.get('/login',(req,res)=>{
  res.send(`
  <form method="post">
    <h2>Login</h2>
    <input name="username" placeholder="User" required><br>
    <input name="password" type="password" placeholder="Password" required><br>
    <button>Login</button>
  </form>`);
});

app.post('/login',(req,res)=>{
  req.session.user = { username:req.body.username };
  res.redirect('/');
});

const auth = (req,res,next)=> req.session.user ? next() : res.redirect('/login');

/* ---------------- PAGE PRINCIPALE ---------------- */
app.get('/', auth, async(req,res)=>{
  const stocks = await Stock.find();
  const rows = stocks.map(s=>`
    <tr data-id="${s._id}">
      <td><input value="${s.sender}"></td>
      <td><input value="${s.destination}"></td>
      <td><input value="${s.amount}"></td>
      <td><input value="${s.currency}"></td>
      <td>
        <button class="save">💾</button>
        <button class="del">❌</button>
      </td>
    </tr>
  `).join('');

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:5px}
input{width:100%}
button{margin:2px}
</style>
</head>
<body>

<h2>Stocks</h2>
<table id="tbl">
<tr><th>Sender</th><th>Destination</th><th>Amount</th><th>Currency</th><th>Actions</th></tr>
${rows}
</table>

<h3>Ajouter</h3>
<input id="s"><input id="d"><input id="a"><input id="c">
<button onclick="add()">Ajouter</button>

<script>
async function add(){
  const res = await fetch('/stock',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      sender:s.value,
      destination:d.value,
      amount:+a.value,
      currency:c.value
    })
  });
  location.reload();
}

document.querySelectorAll('.save').forEach(b=>{
  b.onclick=async()=>{
    const tr=b.closest('tr');
    const id=tr.dataset.id;
    await fetch('/stock/'+id,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        sender:tr.children[0].querySelector('input').value,
        destination:tr.children[1].querySelector('input').value,
        amount:+tr.children[2].querySelector('input').value,
        currency:tr.children[3].querySelector('input').value
      })
    });
    alert('Modifié');
  }
});

document.querySelectorAll('.del').forEach(b=>{
  b.onclick=async()=>{
    const tr=b.closest('tr');
    await fetch('/stock/'+tr.dataset.id,{method:'DELETE'});
    tr.remove();
  }
});
</script>
</body>
</html>
`);
});

/* ---------------- API STOCK ---------------- */
app.post('/stock', async(req,res)=>{
  await Stock.create(req.body);
  res.json({ok:true});
});

app.put('/stock/:id', async(req,res)=>{
  await Stock.findByIdAndUpdate(req.params.id, req.body);
  res.json({ok:true});
});

app.delete('/stock/:id', async(req,res)=>{
  await Stock.findByIdAndDelete(req.params.id);
  res.json({ok:true});
});

/* ---------------- SERVER ---------------- */
app.listen(PORT, ()=>console.log('SERVER OK : ' + PORT));
