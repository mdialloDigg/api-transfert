// server.js

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");
const pdf = require("pdfkit");
const fs = require("fs");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/transferts", {
  // options modernes
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || "transfert-secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/transferts",
    ttl: 14 * 24 * 60 * 60 // 14 days
  })
}));

// User schema & model
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const AuthUser = mongoose.model("AuthUser", userSchema);

// Transfert schema & model
const transfertSchema = new mongoose.Schema({
  sender: String,
  receiver: String,
  amount: Number,
  date: { type: Date, default: Date.now },
  description: String
});

const Transfert = mongoose.model("Transfert", transfertSchema);

// Middleware pour vérifier si utilisateur connecté
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// -------------------- ROUTES --------------------

// LOGIN / SIGNUP

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views/login.html"));
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await AuthUser.findOne({ username });
    if (!user) return res.status(404).send("Utilisateur inconnu");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send("Mot de passe incorrect");

    req.session.userId = user._id;
    res.redirect("/transferts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "views/signup.html"));
});

app.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const newUser = await AuthUser.create({ username, password: hash });
    req.session.userId = newUser._id;
    res.redirect("/transferts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur signup");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send("Erreur logout");
    res.redirect("/login");
  });
});

// -------------------- TRANSFERT CRUD --------------------

// Liste transferts
app.get("/transferts", requireLogin, async (req, res) => {
  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur /transferts");
  }
});

// Nouveau transfert form
app.get("/transferts/new", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "views/new_transfert.html"));
});

// Nouveau transfert POST
app.post("/transferts/new", requireLogin, async (req, res) => {
  try {
    const { sender, receiver, amount, description } = req.body;
    await Transfert.create({ sender, receiver, amount, description });
    res.redirect("/transferts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur création transfert");
  }
});

// Edit transfert form
app.get("/transferts/edit/:id", requireLogin, async (req, res) => {
  try {
    const transfert = await Transfert.findById(req.params.id);
    if (!transfert) return res.status(404).send("Transfert non trouvé");
    res.send(`
      <h1>Edit Transfert</h1>
      <form method="post" action="/transferts/edit/${transfert._id}">
        <input name="sender" value="${transfert.sender}" required/>
        <input name="receiver" value="${transfert.receiver}" required/>
        <input name="amount" value="${transfert.amount}" type="number" required/>
        <input name="description" value="${transfert.description || ""}" placeholder="Description"/>
        <button>Update</button>
      </form>
      <a href="/transferts">Back</a>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur édition transfert");
  }
});

// Edit transfert POST
app.post("/transferts/edit/:id", requireLogin, async (req, res) => {
  try {
    const { sender, receiver, amount, description } = req.body;
    await Transfert.findByIdAndUpdate(req.params.id, { sender, receiver, amount, description });
    res.redirect("/transferts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur update transfert");
  }
});

// Delete transfert
app.post("/transferts/delete/:id", requireLogin, async (req, res) => {
  try {
    await Transfert.findByIdAndDelete(req.params.id);
    res.redirect("/transferts");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur suppression transfert");
  }
});

// Export PDF
app.get("/transferts/export/pdf", requireLogin, async (req, res) => {
  try {
    const transferts = await Transfert.find().sort({ date: -1 });
    const doc = new pdf();
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
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur export PDF");
  }
});

// Serveur
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
