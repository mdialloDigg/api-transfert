const express=require('express')
const mongoose=require('mongoose')
const session=require('express-session')
const bcrypt=require('bcryptjs')
const PDFDocument=require('pdfkit')
const ExcelJS=require('exceljs')

const app=express()
app.use(express.urlencoded({extended:true}))
app.use(express.json())
app.use(session({secret:'transfert-secret',resave:false,saveUninitialized:false}))

mongoose.connect(process.env.MONGODB_URI).then(()=>console.log('Mongo OK')).catch(e=>console.log(e))

const AuthSchema=new mongoose.Schema({username:String,password:String,role:String})
const Auth=mongoose.model('Auth',AuthSchema)

const ProductSchema=new mongoose.Schema({
  name:String,
  sku:String,
  quantity:Number,
  price:Number,
  createdAt:{type:Date,default:Date.now}
})
const Product=mongoose.model('Product',ProductSchema)

const StockHistorySchema=new mongoose.Schema({
  product:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},
  type:String,
  quantity:Number,
  date:{type:Date,default:Date.now},
  ref:String
})
const StockHistory=mongoose.model('StockHistory',StockHistorySchema)

const TransfertSchema=new mongoose.Schema({
  code:String,
  senderFirstName:String,
  senderLastName:String,
  senderPhone:String,
  receiverFirstName:String,
  receiverLastName:String,
  receiverPhone:String,
  originLocation:String,
  destinationLocation:String,
  amount:Number,
  fees:Number,
  recoveryAmount:Number,
  currency:String,
  product:{type:mongoose.Schema.Types.ObjectId,ref:'Product'},
  productQty:Number,
  retired:{type:Boolean,default:false},
  createdAt:{type:Date,default:Date.now}
})
const Transfert=mongoose.model('Transfert',TransfertSchema)

function auth(req,res,next){if(req.session.user)next();else res.redirect('/login')}

async function codeGen(){
  let c,ok=false
  while(!ok){
    c=String.fromCharCode(65+Math.random()*26|0)+(100+Math.random()*900|0)
    ok=!(await Transfert.findOne({code:c}))
  }
  return c
}

app.get('/login',(req,res)=>{
res.send(`
<html><style>
body{background:#ff8c42;display:flex;justify-content:center;align-items:center;height:100vh;font-family:Arial}
form{background:#fff;padding:30px;border-radius:20px;width:300px}
input,button{width:100%;padding:12px;margin:8px 0;border-radius:8px}
button{background:#ff8c42;color:white;border:none}
</style>
<form method="post">
<h2>Connexion</h2>
<input name="username" required placeholder="Utilisateur">
<input type="password" name="password" required placeholder="Mot de passe">
<button>Login</button>
</form>
</html>
`)})

app.post('/login',async(req,res)=>{
let u=await Auth.findOne({username:req.body.username})
if(!u){u=new Auth({username:req.body.username,password:bcrypt.hashSync(req.body.password,10)});await u.save()}
if(!bcrypt.compareSync(req.body.password,u.password))return res.send('Erreur')
req.session.user=u
res.redirect('/dashboard')
})

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/login'))})

app.get('/dashboard',auth,async(req,res)=>{
const products=await Product.find()
res.send(`
<html><style>
body{font-family:Arial;background:#f4f6f9;padding:20px}
a{display:inline-block;margin:10px;padding:12px;background:#ff8c42;color:white;border-radius:10px;text-decoration:none}
</style>
<h2>Dashboard</h2>
<a href="/transferts">Transferts</a>
<a href="/products">Produits / Stock</a>
<a href="/logout">Déconnexion</a>
</html>
`)
})

app.get('/products',auth,async(req,res)=>{
const p=await Product.find()
res.send(`
<html><style>
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:6px}
</style>
<h2>Stock</h2>
<form method="post">
<input name="name" placeholder="Produit">
<input name="sku" placeholder="SKU">
<input name="quantity" type="number">
<input name="price" type="number">
<button>Ajouter</button>
</form>
<table>
<tr><th>Produit</th><th>Stock</th><th>Prix</th></tr>
${p.map(x=>`<tr><td>${x.name}</td><td>${x.quantity}</td><td>${x.price}</td></tr>`).join('')}
</table>
<a href="/dashboard">Retour</a>
</html>
`)
})

app.post('/products',auth,async(req,res)=>{
const p=new Product({...req.body})
await p.save()
await new StockHistory({product:p._id,type:'IN',quantity:p.quantity,ref:'Initial'}).save()
res.redirect('/products')
})

app.get('/transferts',auth,async(req,res)=>{
const t=await Transfert.find().populate('product')
const p=await Product.find()
res.send(`
<html><style>
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:6px}
button{background:#ff8c42;color:white;border:none;padding:5px}
</style>
<h2>Transferts</h2>
<form method="post">
<input name="senderFirstName" placeholder="Exp Prénom">
<input name="senderLastName" placeholder="Exp Nom">
<input name="senderPhone" placeholder="Tel">
<input name="receiverFirstName" placeholder="Dest Prénom">
<input name="receiverLastName" placeholder="Dest Nom">
<input name="amount" type="number" placeholder="Montant">
<input name="fees" type="number" placeholder="Frais">
<select name="product">
${p.map(x=>`<option value="${x._id}">${x.name}</option>`).join('')}
</select>
<input name="productQty" type="number" placeholder="Qté">
<button>Ajouter</button>
</form>
<table>
<tr><th>Code</th><th>Client</th><th>Produit</th><th>Qté</th><th>Statut</th><th>Action</th></tr>
${t.map(x=>`
<tr>
<td>${x.code}</td>
<td>${x.senderFirstName}</td>
<td>${x.product?x.product.name:''}</td>
<td>${x.productQty||''}</td>
<td>${x.retired?'Retiré':'En cours'}</td>
<td>${!x.retired?`<form method="post" action="/retirer"><input type="hidden" name="id" value="${x._id}"><button>Retirer</button></form>`:''}</td>
</tr>`).join('')}
</table>
<a href="/dashboard">Retour</a>
</html>
`)
})

app.post('/transferts',auth,async(req,res)=>{
const prod=await Product.findById(req.body.product)
if(prod.quantity<req.body.productQty)return res.send('Stock insuffisant')
prod.quantity-=req.body.productQty
await prod.save()
await new StockHistory({product:prod._id,type:'OUT',quantity:req.body.productQty,ref:'Transfert'}).save()
const t=new Transfert({...req.body,code:await codeGen(),recoveryAmount:req.body.amount-req.body.fees})
await t.save()
res.redirect('/transferts')
})

app.post('/retirer',auth,async(req,res)=>{
await Transfert.findByIdAndUpdate(req.body.id,{retired:true})
res.redirect('/transferts')
})

app.get('/export/pdf',auth,async(req,res)=>{
const t=await Transfert.find()
const doc=new PDFDocument()
res.setHeader('Content-Type','application/pdf')
doc.pipe(res)
t.forEach(x=>doc.text(x.code+' '+x.senderFirstName))
doc.end()
})

app.get('/export/excel',auth,async(req,res)=>{
const t=await Transfert.find()
const wb=new ExcelJS.Workbook()
const sh=wb.addWorksheet('Transferts')
sh.addRow(['Code','Client','Montant'])
t.forEach(x=>sh.addRow([x.code,x.senderFirstName,x.amount]))
res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
await wb.xlsx.write(res)
res.end()
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>console.log('Server '+PORT))
 