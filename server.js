const express=require('express')
const mongoose=require('mongoose')
const session=require('express-session')
const bodyParser=require('body-parser')
const app=express()

mongoose.connect(process.env.MONGO_URI)

app.use(bodyParser.urlencoded({extended:true}))
app.use(bodyParser.json())
app.use(session({secret:'x',resave:false,saveUninitialized:false}))

const User=mongoose.model('User',new mongoose.Schema({u:String,p:String,r:String}))
const Transfer=mongoose.model('Transfer',new mongoose.Schema({
o:String,d:String,v:String,m:Number,da:String
}))
const Stock=mongoose.model('Stock',new mongoose.Schema({
n:String,q:Number,d:String
}))

;(async()=>{
if(await User.countDocuments()==0){
await User.create({u:'a',p:'a',r:'a'})
await User.create({u:'admin2',p:'admin2',r:'admin2'})
}})()

const auth=(req,res,n)=>req.session.u?n():res.redirect('/')
const admin=(req,res,n)=>req.session.u.r==='admin2'?n():res.sendStatus(403)

app.get('/',(req,res)=>res.send(`
<html><meta name=viewport content=width=device-width>
<style>
body{font-family:Arial;background:#eee}
.box{max-width:350px;margin:100px auto;background:#fff;padding:20px}
input,button{width:100%;padding:10px;margin:5px}
</style>
<div class=box>
<h3>Login</h3>
<input id=u placeholder=Utilisateur>
<input id=p type=password placeholder=Mot de passe>
<button onclick=l()>Se connecter</button>
</div>
<script>
function l(){
fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({u:u.value,p:p.value})})
.then(r=>r.json()).then(d=>d.ok?location='/app':alert('Erreur'))
}
</script>`))

app.post('/login',async(req,res)=>{
const u=await User.findOne(req.body)
if(!u)return res.json({ok:false})
req.session.u=u
res.json({ok:true})
})

app.get('/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')))

app.get('/app',auth,async(req,res)=>{
const q={}
if(req.query.d)q.d=req.query.d
if(req.query.v)q.v=req.query.v
const t=await Transfer.find(q)
const s=await Stock.find()

let totals={}
t.forEach(x=>{
let k=x.d+' '+x.v
totals[k]=(totals[k]||0)+x.m
})

res.send(`
<html><meta name=viewport content=width=device-width>
<style>
body{font-family:Arial}
table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ccc;padding:5px}
input,button{padding:6px;margin:2px}
</style>
<h3>${req.session.u.u}</h3>
<a href=/logout>Déconnexion</a>

<h4>Totaux</h4>
${Object.entries(totals).map(x=>`<div>${x[0]} : ${x[1]}</div>`).join('')}

<h4>Recherche</h4>
<input id=s onkeyup=r()>

<h4>Transferts</h4>
<table id=t>
<tr><th>O</th><th>D</th><th>V</th><th>M</th><th>Date</th><th></th></tr>
${t.map(x=>`
<tr>
<td>${x.o}</td><td>${x.d}</td><td>${x.v}</td><td>${x.m}</td><td>${x.da}</td>
<td>
<button onclick="e('${x._id}')">✎</button>
${req.session.u.r==='admin2'?`<button onclick="dt('${x._id}')">X</button>`:''}
</td>
</tr>`).join('')}
</table>

<h4>Ajouter / Modifier</h4>
<input id=o placeholder=Origine>
<input id=d placeholder=Destination>
<input id=v placeholder=Devise>
<input id=m type=number placeholder=Montant>
<input id=da placeholder=Date>
<input id=id hidden>
<button onclick=save()>Valider</button>

<h4>Stock</h4>
<table>
${s.map(x=>`
<tr><td>${x.n}</td><td>${x.q}</td><td>${x.d}</td>
<td>${req.session.u.r==='admin2'?`<button onclick="ds('${x._id}')">X</button>`:''}</td></tr>`).join('')}
</table>
<input id=sn placeholder=Nom>
<input id=sq type=number placeholder=Quantité>
<input id=sd placeholder=Devise>
<button onclick=ss()>Ajouter</button>

<button onclick=window.print()>Imprimer</button>

<script>
function r(){
let v=s.value.toLowerCase()
document.querySelectorAll('#t tr').forEach((x,i)=>{
if(i==0)return
x.style.display=x.innerText.toLowerCase().includes(v)?'':'none'
})
}
function save(){
fetch('/t',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({id:id.value,o:o.value,d:d.value,v:v.value,m:m.value,da:da.value})})
.then(()=>location.reload())
}
function e(i){
fetch('/t/'+i).then(r=>r.json()).then(x=>{
id.value=x._id;o.value=x.o;d.value=x.d;v.value=x.v;m.value=x.m;da.value=x.da
})
}
function dt(i){fetch('/t/'+i,{method:'DELETE'}).then(()=>location.reload())}
function ss(){
fetch('/s',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({n:sn.value,q:sq.value,d:sd.value})})
.then(()=>location.reload())
}
function ds(i){fetch('/s/'+i,{method:'DELETE'}).then(()=>location.reload())}
</script>`)})

app.post('/t',auth,async(req,res)=>{
req.body.id
?await Transfer.findByIdAndUpdate(req.body.id,req.body)
:await Transfer.create(req.body)
res.json(true)
})
app.get('/t/:id',auth,async(req,res)=>res.json(await Transfer.findById(req.params.id)))
app.delete('/t/:id',auth,admin,async(req,res)=>{await Transfer.findByIdAndDelete(req.params.id);res.json(true)})

app.post('/s',auth,async(req,res)=>{await Stock.create(req.body);res.json(true)})
app.delete('/s/:id',auth,admin,async(req,res)=>{await Stock.findByIdAndDelete(req.params.id);res.json(true)})

app.listen(process.env.PORT||3000,'0.0.0.0')
