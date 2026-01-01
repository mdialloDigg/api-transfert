const express = require('express')
const mongoose = require('mongoose')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const PDFDocument = require('pdfkit')
const ExcelJS = require('exceljs')
const app = express()
app.use(express.urlencoded({extended:true}))
app.use(express.json())
app.use(session({secret:'transfert-secret',resave:false,saveUninitialized:false}))

mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/transfert')
.then(()=>console.log('MongoDB connecté')).catch(console.error)

// Schemas
const AuthSchema = new mongoose.Schema({username:String,password:String,role:{type:String,default:'admin'}})
const Auth = mongoose.model('Auth',AuthSchema)
const ProductSchema = new mongoose.Schema({name:String,sku:String,quantity:Number,price:Number,createdAt:{type:Date,default:Date.now}})
const Product = mongoose.model('Product',ProductSchema)
const StockHistorySchema = new mongoose.Schema({product:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},type:String,quantity:Number,ref:String,date:{type:Date,default:Date.now}})
const StockHistory = mongoose.model('StockHistory',StockHistorySchema)
const TransfertSchema = new mongoose.Schema({
  code:String,senderFirstName:String,senderLastName:String,senderPhone:String,
  receiverFirstName:String,receiverLastName:String,receiverPhone:String,
  originLocation:String,destinationLocation:String,
  amount:Number,fees:Number,recoveryAmount:Number,
  currency:String,product:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},
  productQty:Number,retired:{type:Boolean,default:false},createdAt:{type:Date,default:Date.now}
})
const Transfert = mongoose.model('Transfert',TransfertSchema)

// Auth middleware
const auth = (req,res,next) => req.session.user ? next() : res.redirect('/login')
async function genCode(){let c,ok=false;while(!ok){c=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0);ok=!(await Transfert.findOne({code:c}))}return c}

// LOGIN
app.get('/login',(req,res)=>res.send(`<html><style>
body{margin:0;font-family:Arial;background:linear-gradient(135deg,#ff8c42,#ffa64d);display:flex;justify-content:center;align-items:center;height:100vh}
.box{background:white;padding:40px;border-radius:20px;width:320px;text-align:center}
input,button{width:100%;padding:14px;margin:10px 0;border-radius:10px;font-size:16px}
button{background:#ff8c42;color:white;border:none;cursor:pointer}
</style><div class="box"><h2>Connexion</h2>
<form method="post">
<input name="username" required placeholder="Utilisateur">
<input type="password" name="password" required placeholder="Mot de passe">
<button>Connexion</button></form></div></html>`))
app.post('/login',async(req,res)=>{
let u=await Auth.findOne({username:req.body.username})
if(!u){u=new Auth({username:req.body.username,password:bcrypt.hashSync(req.body.password,10)});await u.save()}
if(!bcrypt.compareSync(req.body.password,u.password))return res.send('Mot de passe incorrect')
req.session.user=u;res.redirect('/dashboard')})
app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/login')))

// DASHBOARD
app.get('/dashboard',auth,(req,res)=>res.send(`<html><style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
a{display:inline-block;margin:10px;padding:14px 20px;background:#ff8c42;color:white;border-radius:10px;text-decoration:none}
</style><h2>Dashboard</h2>
<a href="/transferts">Transferts</a>
<a href="/products">Stock</a>
<a href="/logout">Déconnexion</a></html>`))

// STOCK ROUTES
app.get('/products',auth,async(req,res)=>{
const p=await Product.find()
res.send(`<html><style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
form{display:grid;gap:10px;max-width:400px}
input,button,select{padding:10px;border-radius:8px;border:1px solid #ccc;font-size:14px}
button{background:#ff8c42;color:white;border:none;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:20px}
td,th{border:1px solid #ccc;padding:6px;text-align:left}
th{background:#ff8c42;color:white}
</style><h2>Stock</h2>
<form method="post">
<input name="name" placeholder="Produit" required>
<input name="sku" placeholder="SKU">
<input name="quantity" type="number" required>
<input name="price" type="number" placeholder="Prix">
<button>Ajouter Produit</button>
</form>
<table>
<tr><th>Produit</th><th>SKU</th><th>Stock</th><th>Prix</th><th>Actions</th></tr>
${p.map(x=>`<tr>
<td>${x.name}</td><td>${x.sku||''}</td><td>${x.quantity}</td><td>${x.price||''}</td>
<td><form method="post" action="/products/delete" style="display:inline"><input type="hidden" name="id" value="${x._id}"><button>Supprimer</button></form></td>
</tr>`).join('')}
</table><a href="/dashboard">Retour</a></html>`)})

app.post('/products',auth,async(req,res)=>{const p=new Product(req.body);await p.save();await new StockHistory({product:p._id,type:'IN',quantity:p.quantity,ref:'Initial'}).save();res.redirect('/products')})
app.post('/products/delete',auth,async(req,res)=>{await Product.findByIdAndDelete(req.body.id);await StockHistory.deleteMany({product:req.body.id});res.redirect('/products')})

// TRANSFERT ROUTES
app.get('/transferts',auth,async(req,res)=>{
const {q='',status=''}=req.query
const p=await Product.find()
res.send(`<html><style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
form{display:grid;gap:10px;max-width:500px;margin-bottom:20px}
input,select,button{padding:10px;border-radius:8px;border:1px solid #ccc;font-size:14px}
button{background:#ff8c42;color:white;border:none;cursor:pointer}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:6px;text-align:left}
th{background:#ff8c42;color:white}
.retired{background:#fff3b0}
</style>
<h2>Transferts</h2>
<form id="filterForm">
<input name="q" placeholder="Recherche" value="${q}">
<select name="status">
<option value="">Tous</option>
<option value="open" ${status==='open'?'selected':''}>Non retiré</option>
<option value="retired" ${status==='retired'?'selected':''}>Retiré</option>
</select>
<button type="submit">Filtrer</button>
</form>
<form id="transfertForm">
<input type="hidden" name="id" id="transfertId">
<input name="senderFirstName" placeholder="Exp Prénom" required>
<input name="senderLastName" placeholder="Exp Nom" required>
<input name="senderPhone" placeholder="Téléphone" required>
<input name="receiverFirstName" placeholder="Dest Prénom" required>
<input name="receiverLastName" placeholder="Dest Nom" required>
<input name="receiverPhone" placeholder="Dest Téléphone" required>
<input name="originLocation" placeholder="Origine" required>
<input name="destinationLocation" placeholder="Destination" required>
<input name="amount" type="number" placeholder="Montant" required>
<input name="fees" type="number" placeholder="Frais" required>
<select name="currency"><option>GNF</option><option>EUR</option><option>USD</option></select>
<select name="product" id="productSelect">${p.map(x=>`<option value="${x._id}">${x.name}</option>`).join('')}</select>
<input name="productQty" type="number" placeholder="Qté produit" required>
<button id="submitBtn">Ajouter / Modifier Transfert</button>
</form>
<a href="/dashboard">Dashboard</a>
<a href="/transferts/pdf">PDF</a><a href="/transferts/excel">Excel</a><a href="/transferts/word">Word</a>

<table><thead><tr><th>Code</th><th>Expéditeur</th><th>Destinataire</th><th>Produit</th><th>Qté</th><th>Montant</th><th>Devise</th><th>Status</th><th>Actions</th></tr></thead>
<tbody></tbody></table>

<script>
async function fetchTransferts(){
const q=document.querySelector('input[name="q"]').value
const status=document.querySelector('select[name="status"]').value
const res=await fetch(`/transferts/ajax?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`)
const data=await res.json()
const tbody=document.querySelector('table tbody')
tbody.innerHTML=''
data.forEach(x=>{
const tr=document.createElement('tr')
if(x.retired)tr.classList.add('retired')
tr.innerHTML=\`<td>\${x.code}</td><td>\${x.sender}</td><td>\${x.receiver}</td><td>\${x.productName}</td><td>\${x.qty}</td><td>\${x.amount}</td><td>\${x.currency}</td><td>\${x.retired?'Retiré':'En cours'}</td>
<td><button class="edit" data-id="\${x.id}">✏️ Modifier</button>\${!x.retired?`<button class="retirer" data-id="\${x.id}">Retirer & Imprimer</button>`:''}<button class="delete" data-id="\${x.id}">Supprimer</button></td>\`
tbody.appendChild(tr)
})
document.querySelectorAll('.edit').forEach(btn=>btn.onclick=async()=>{
const res=await fetch(`/transferts/ajax?id=${btn.dataset.id}`)
const t=await res.json()
document.getElementById('transfertId').value=t._id
document.querySelector('input[name="senderFirstName"]').value=t.senderFirstName
document.querySelector('input[name="senderLastName"]').value=t.senderLastName
document.querySelector('input[name="senderPhone"]').value=t.senderPhone
document.querySelector('input[name="receiverFirstName"]').value=t.receiverFirstName
document.querySelector('input[name="receiverLastName"]').value=t.receiverLastName
document.querySelector('input[name="receiverPhone"]').value=t.receiverPhone
document.querySelector('input[name="originLocation"]').value=t.originLocation
document.querySelector('input[name="destinationLocation"]').value=t.destinationLocation
document.querySelector('input[name="amount"]').value=t.amount
document.querySelector('input[name="fees"]').value=t.fees
document.querySelector('select[name="currency"]').value=t.currency
document.querySelector('select[name="product"]').value=t.product
document.querySelector('input[name="productQty"]').value=t.productQty
document.getElementById('submitBtn').innerText='Modifier Transfert'
})
document.querySelectorAll('.retirer').forEach(btn=>btn.onclick=async()=>{
const r=await fetch('/transferts/ajax/retirer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:btn.dataset.id})})
window.open(`/transferts/print/${btn.dataset.id}`,'_blank')
fetchTransferts()
})
document.querySelectorAll('.delete').forEach(btn=>btn.onclick=async()=>{
if(!confirm('Confirmer suppression ?'))return
await fetch('/transferts/ajax/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:btn.dataset.id})})
fetchTransferts()
})
}
document.querySelector('#transfertForm').onsubmit=async(e)=>{
e.preventDefault()
const fd=Object.fromEntries(new FormData(e.target).entries())
if(fd.id){
await fetch(`/transferts/${fd.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(fd)})
}else{
await fetch('/transferts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fd)})
}
e.target.reset()
document.getElementById('submitBtn').innerText='Ajouter / Modifier Transfert'
fetchTransferts()
}
document.querySelector('input[name="q"]').addEventListener('input',fetchTransferts)
document.querySelector('select[name="status"]').addEventListener('change',fetchTransferts)
fetchTransferts()
</script>
</html>`)

// AJAX routes
app.get('/transferts/ajax',auth,async(req,res)=>{
const {q='',status='',id=''}=req.query
if(id){const t=await Transfert.findById(id).populate('product');return res.json(t)}
let t=await Transfert.find().populate('product')
if(q)t=t.filter(x=>x.code?.includes(q)||x.senderFirstName?.toLowerCase().includes(q.toLowerCase())||x.senderPhone?.includes(q)||(x.product&&x.product.name.toLowerCase().includes(q.toLowerCase())))
if(status==='retired')t=t.filter(x=>x.retired)
if(status==='open')t=t.filter(x=>!x.retired)
res.json(t.map(x=>({id:x._id,code:x.code,sender:x.senderFirstName+' '+x.senderLastName,receiver:x.receiverFirstName+' '+x.receiverLastName,productName:x.product?x.product.name:'',product:x.product?x.product._id:'',qty:x.productQty,amount:x.amount,currency:x.currency,retired:x.retired})))
})
app.post('/transferts/ajax/retirer',auth,async(req,res)=>{
const t=await Transfert.findById(req.body.id)
if(t){t.retired=true;await t.save()
if(t.product){const prod=await Product.findById(t.product);prod.quantity-=t.productQty;await prod.save();await StockHistory({product:prod._id,type:'OUT',quantity:t.productQty,ref:'Retrait Transfert'}).save()}}
res.json({ok:true})
})
app.post('/transferts/ajax/delete',auth,async(req,res)=>{
const t=await Transfert.findById(req.body.id)
if(t&&t.product){const prod=await Product.findById(t.product);prod.quantity+=parseInt(t.productQty);await prod.save();await StockHistory({product:prod._id,type:'IN',quantity:t.productQty,ref:'Annulation Transfert'}).save()}
await Transfert.findByIdAndDelete(req.body.id)
res.json({ok:true})
})

// PRINT TICKET
app.get('/transferts/print/:id',auth,async(req,res)=>{
const t=await Transfert.findById(req.params.id).populate('product')
if(!t)return res.send('Transfert introuvable')
res.send(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
body{font-family:Arial;text-align:center;padding:10px}
.ticket{border:1px dashed #333;padding:10px;width:280px;margin:auto}
h3{margin:5px 0}p{margin:3px 0;font-size:14px}
button{margin-top:5px;padding:5px 10px}
</style></head><body>
<div class="ticket">
<h3>💰 Transfert</h3>
<p>Code: ${t.code}</p>
<p>Exp: ${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})</p>
<p>Dest: ${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})</p>
<p>Produit: ${t.product? t.product.name:''} | Qté: ${t.productQty}</p>
<p>Montant: ${t.amount} ${t.currency}</p>
<p>Frais: ${t.fees}</p>
<p>Reçu: ${t.recoveryAmount}</p>
<p>Statut: ${t.retired?'Retiré':'Non retiré'}</p>
</div>
<button onclick="window.print()">🖨 Imprimer</button>
</body></html>`)
})

app.listen(process.env.PORT||3000,()=>console.log('🚀 Serveur lancé sur http://localhost:3000'))
