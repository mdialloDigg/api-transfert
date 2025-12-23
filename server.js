// server.js

const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/transferts")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || "secretkey",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/transferts",
    ttl: 14 * 24 * 60 * 60 // 14 days
  })
}));

// -------------------- MODELS --------------------
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const User = mongoose.model("User", userSchema);

const transfertSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  amount: Number,
  description: String,
  date: { type: Date, default: Date.now }
});
const Transfert = mongoose.model("Transfert", transfertSchema);

// -------------------- MIDDLEWARE --------------------
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// -------------------- ROUTES --------------------

// LOGIN
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.send("Utilisateur non trouvé");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send("Mot de passe incorrect");
    req.session.userId = user._id;
    res.redirect("/transferts");
  } catch (err) {
    res.status(500).send("Erreur serveur");
  }
});

// SIGNUP
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "views/signup.html"));
});
app.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username, password: hashed });
    req.session.userId = newUser._id;
    res.redirect("/transferts");
  } catch (err) {
    res.status(500).send("Erreur serveur signup");
  }
});

// LOGOUT
app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send("Erreur logout");
    res.redirect("/login");
  });
});

// -------------------- TRANSFERTS CRUD --------------------

// Liste transferts
app.get("/transferts", requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ date: -1 });
  let list = transferts.map(t => `
    <li>
      ${t.sender} -> ${t.receiver} : ${t.amount} € (${t.date.toLocaleDateString()})
      <a href="/transferts/edit/${t._id}">Edit</a>
      <form style="display:inline" method="post" action="/transferts/delete/${t._id}">
        <button>Delete</button>
      </form>
    </li>
  `).join("");
  res.send(`
    <h1>Liste des transferts</h1>
    <ul>${list}</ul>
    <a href="/transferts/new">Ajouter un transfert</a>
    <form method="post" action="/logout"><button>Logout</button></form>
    <form method="get" action="/transferts/export/pdf"><button>Exporter PDF</button></form>
  `);
});

// Nouveau transfert
app.get("/transferts/new", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "views/new_transfert.html"));
});
app.post("/transferts/new", requireLogin, async (req, res) => {
  const { sender, receiver, amount, description } = req.body;
  await Transfert.create({ sender, receiver, amount, description });
  res.redirect("/transferts");
});

// Edit transfert
app.get("/transferts/edit/:id", requireLogin, async (req, res) => {
  const t = await Transfert.findById(req.params.id);
  if (!t) return res.send("Transfert non trouvé");
  res.send(`
    <h1>Edit Transfert</h1>
    <form method="post" action="/transferts/edit/${t._id}">
      <input name="sender" value="${t.sender}" required/>
      <input name="receiver" value="${t.receiver}" required/>
      <input name="amount" value="${t.amount}" type="number" required/>
      <input name="description" value="${t.description || ""}" placeholder="Description"/>
      <button>Update</button>
    </form>
    <a href="/transferts">Back</a>
  `);
});
app.post("/transferts/edit/:id", requireLogin, async (req, res) => {
  const { sender, receiver, amount, description } = req.body;
  await Transfert.findByIdAndUpdate(req.params.id, { sender, receiver, amount, description });
  res.redirect("/transferts");
});

// Delete transfert
app.post("/transferts/delete/:id", requireLogin, async (req, res) => {
  await Transfert.findByIdAndDelete(req.params.id);
  res.redirect("/transferts");
});

// Export PDF
app.get("/transferts/export/pdf", requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ date: -1 });
  const doc = new PDFDocument();
  const filePath = path.join(__dirname, "transferts.pdf");
  doc.pipe(fs.createWriteStream(filePath));
  doc.fontSize(18).text("Liste des transferts", { align: "center" });
  doc.moveDown();
  transferts.forEach(t => {
    doc.fontSize(12).text(`${t.sender} -> ${t.receiver} : ${t.amount} € (${t.date.toLocaleDateString()}) - ${t.description || ""}`);
  });
  doc.end();
  doc.on("finish", () => {
    res.download(filePath, "transferts.pdf");
  });
});

// -------------------- START SERVER --------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
