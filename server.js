// server.js

import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/test")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || "transfert-secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || "mongodb://localhost:27017/test",
    ttl: 14 * 24 * 60 * 60 // 14 days
  })
}));

// Models
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const AuthUser = mongoose.model("AuthUser", userSchema);

// Middleware pour vérifier si utilisateur connecté
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// ROUTES

// Formulaire login
app.get("/login", (req, res) => {
  res.send(`
    <form action="/login" method="post">
      <input name="username" placeholder="Username" required/>
      <input name="password" type="password" placeholder="Password" required/>
      <button>Login</button>
    </form>
  `);
});

// Login POST
app.post("/login", async (req, res) => {
  console.log("LOGIN BODY:", req.body);
  try {
    const { username, password } = req.body;
    const user = await AuthUser.findOne({ username });
    if (!user) return res.status(404).send("Utilisateur inconnu");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send("Mot de passe incorrect");

    req.session.userId = user._id;
    res.redirect("/users/choice");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

// Formulaire pour créer un utilisateur (signup)
app.get("/signup", (req, res) => {
  res.send(`
    <form action="/signup" method="post">
      <input name="username" placeholder="Username" required/>
      <input name="password" type="password" placeholder="Password" required/>
      <button>Sign Up</button>
    </form>
  `);
});

// Signup POST
app.post("/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const newUser = await AuthUser.create({ username, password: hash });
    req.session.userId = newUser._id;
    res.redirect("/users/choice");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur signup");
  }
});

// Liste des utilisateurs (CRUD Read)
app.get("/users/all", requireLogin, async (req, res) => {
  try {
    const users = await AuthUser.find({}, "-password");
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur /users/all");
  }
});

// Page choix après login
app.get("/users/choice", requireLogin, (req, res) => {
  res.send(`
    <h1>Bienvenue!</h1>
    <a href="/users/all">Voir tous les utilisateurs</a>
    <form action="/logout" method="post"><button>Logout</button></form>
  `);
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send("Erreur logout");
    res.redirect("/login");
  });
});

// Serveur
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
