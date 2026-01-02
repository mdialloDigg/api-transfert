const express=require('express')
const mongoose=require('mongoose')
const session=require('express-session')
const bodyParser=require('body-parser')
const app=express()
const port=process.env.PORT||3000

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended:true}))
app.use(session({secret:'secretkey',resave:false,saveUninitialized:false}))

mongoose.connect(process.env.MONGO_URI||'mongodb://127.0.0.1:27017/transferts',{useNewUrlParser:true,useUnifiedTopology:true})

const User=mongoose.model('User',new mongoose.Schema({username:String,password:String,role:String}))
const Transfert=mongoose.model('Transfert',new mongoose.Schema({
code:String,senderFirstName:String,senderLastName:String,senderPhone:String,
originLocation:String,destinationLocation:String,amount:Number,currency:String,retired:Boolean
}))
const Stock=mongoose.model('Stock',new mongoose.Schema({product:String,quantity:Number,location:String}))

async function initUsers(){
const c=await User.countDocuments()
if(c===0){
await User.create({username:'a',password:'a',role:'a'})
await User.create({username:'admin2',password:'admin2',role:'admin2'})
}}
initUsers()

function auth(req,res,next){if(req.session.user)next();else res.redirect('/')}
function canEdit(req){return req.session.user.role==='a'||req.session.user.role==='admin2'}

app.get('/',(req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;background:#eee}
form{background:#fff;padding:20px;border-radius:8px;width:280px}
input,button{width:100%;padding:10px;margin:5px 0}
button{background:#007bff;color:#fff;border:none}
</style></head><body>
<form id="login">
<input id="u" placeholder="Utilisateur" required>
<input id="p" type="password" placeholder="Mot de passe" required>
<button>Se connecter</button>
</form>
<script>
document.getElementById('login').onsubmit=async e=>{
e.preventDefault()
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:u.value,password:p.value})})
if(r.redirected)location=r.url
else alert(await r.text())
}
</script></body></html>`)
})

app.post('/login',async(req,res)=>{
const u=await User.findOne(req.body)
if(u){req.session.user=u;res.redirect('/dashboard')}
else res.status(401).send('Erreur login')
})

app.get('/logout',(req,res)=>{req.session.destroy(()=>res.redirect('/'))})

app.get('/dashboard',auth,(req,res)=>{
res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:sans-serif;margin:0}
header{background:#007bff;color:#fff;padding:10px;display:flex;flex-wrap:wrap;gap:5px}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:4px;text-align:center}
input,button,select{padding:5px;margin:2px}
@media(max-width:600px){table,thead,tbody,tr,td,th{display:block}}
</style></head><body>
<header>
<input id="search" placeholder="Recherche">
<button onclick="showForm()">Nouveau</button>
<button onclick="showStock()">Stock</button>
<button onclick="print()">Imprimer</button>
<button onclick="location='/logout'">Déconnexion</button>
</header>

<div id="list">
<table>
<thead><tr><th>Code</th><th>Nom</th><th>Tel</th><th>Origine</th><th>Destination</th><th>Montant</th><th>Devise</th><th>Retiré</th><th></th></tr></thead>
<tbody id="tbody"></tbody>
<tfoot id="totals"></tfoot>
</table>
</div>

<div id="form" style="display:none">
<input id="id"><input id="code"><input id="fn"><input id="ln"><input id="ph">
<input id="or"><input id="de"><input id="am" type="number"><input id="cu">
<select id="re"><option value="false">Non</option><option value="true">Oui</option></select>
<button onclick="save()">Valider</button><button onclick="back()">Retour</button>
</div>

<div id="stock" style="display:none">
<input id="sid"><input id="sp"><input id="sq" type="number"><input id="sl">
<button onclick="saveStock()">Valider</button><button onclick="back()">Retour</button>
<table><tbody id="sbody"></tbody></table>
</div>

<script>
async function load(){
const d=await(await fetch('/api/transferts')).json()
tbody.innerHTML=''
totals.innerHTML=''
d.transferts.forEach(x=>{
tbody.innerHTML+=\`<tr><td>\${x.code}</td><td>\${x.senderLastName}</td><td>\${x.senderPhone}</td>
<td>\${x.originLocation}</td><td>\${x.destinationLocation}</td>
<td>\${x.amount}</td><td>\${x.currency}</td><td>\${x.retired?'Oui':'Non'}</td>
<td>\${x.canEdit?'<button onclick="edit(\\''+x._id+'\\')">✎</button><button onclick="del(\\''+x._id+'\\')">✖</button>':''}</td></tr>\`
})
for(let k in d.totals){
let [d1,c]=k.split('_')
totals.innerHTML+=\`<tr><td colspan="4">Total \${d1}</td><td colspan="2">\${d.totals[k]}</td><td>\${c}</td><td colspan="2"></td></tr>\`
}}
async function save(){
const data={code:code.value,senderFirstName:fn.value,senderLastName:ln.value,
senderPhone:ph.value,originLocation:or.value,destinationLocation:de.value,
amount:+am.value,currency:cu.value,retired:re.value==='true'}
if(id.value)await fetch('/api/transferts/'+id.value,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
else await fetch('/api/transferts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
back();load()
}
async function edit(i){
const d=await(await fetch('/api/transferts')).json()
const x=d.transferts.find(e=>e._id===i)
Object.assign(window,{id:{value:x._id},code:{value:x.code},fn:{value:x.senderFirstName},
ln:{value:x.senderLastName},ph:{value:x.senderPhone},or:{value:x.originLocation},
de:{value:x.destinationLocation},am:{value:x.amount},cu:{value:x.currency},re:{value:x.retired}})
showForm()
}
async function del(i){if(confirm('Supprimer')){await fetch('/api/transferts/'+i,{method:'DELETE'});load()}}
function showForm(){list.style.display='none';form.style.display='block';stock.style.display='none'}
function showStock(){list.style.display='none';form.style.display='none';stock.style.display='block';loadStock()}
function back(){form.style.display='none';stock.style.display='none';list.style.display='block'}
async function loadStock(){
const d=await(await fetch('/api/stock')).json()
sbody.innerHTML=''
d.forEach(x=>sbody.innerHTML+=\`<tr><td>\${x.product}</td><td>\${x.quantity}</td><td>\${x.location}</td>
<td><button onclick="ds('\${x._id}')">✖</button></td></tr>\`)
}
async function saveStock(){
await fetch('/api/stock',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({product:sp.value,quantity:+sq.value,location:sl.value})})
loadStock()
}
async function ds(i){await fetch('/api/stock/'+i,{method:'DELETE'});loadStock()}
search.oninput=e=>{
[...tbody.children].forEach(r=>r.style.display=r.textContent.toLowerCase().includes(e.target.value.toLowerCase())?'':'none')
}
load()
</script></body></html>`)
})

app.get('/api/transferts',auth,async(req,res)=>{
const t=await Transfert.find()
let totals={}
t.forEach(x=>{
const k=x.destinationLocation+'_'+x.currency
totals[k]=(totals[k]||0)+x.amount
x.canEdit=canEdit(req)
})
res.json({transferts:t,totals})
})
app.post('/api/transferts',auth,async(req,res)=>{if(canEdit(req))await Transfert.create(req.body);res.json({ok:true})})
app.put('/api/transferts/:id',auth,async(req,res)=>{if(canEdit(req))await Transfert.findByIdAndUpdate(req.params.id,req.body);res.json({ok:true})})
app.delete('/api/transferts/:id',auth,async(req,res)=>{if(canEdit(req))await Transfert.findByIdAndDelete(req.params.id);res.json({ok:true})})

app.get('/api/stock',auth,async(req,res)=>res.json(await Stock.find()))
app.post('/api/stock',auth,async(req,res)=>{if(canEdit(req))await Stock.create(req.body);res.json({ok:true})})
app.delete('/api/stock/:id',auth,async(req,res)=>{if(canEdit(req))await Stock.findByIdAndDelete(req.params.id);res.json({ok:true})})

app.listen(port,'0.0.0.0')
