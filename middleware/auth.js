const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({ error: "Token manquant" });
    }

    try {
        const decoded = jwt.verify(token, "SECRET_JWT");
        req.userId = decoded.id;
        next();
    } catch {
        res.status(401).json({ error: "Token invalide" });
    }
};