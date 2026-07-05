//Request guards shared by all route modules.

const jwt = require("jsonwebtoken");
const { JWT_SECRET, SESSION_COOKIE } = require("../config");
const { dbReady } = require("../db");

//Verifies the session JWT cookie and attaches the identity to req.user.
const requireAuth = (req, res, next) => {
  try {
    req.user = jwt.verify(req.cookies[SESSION_COOKIE], JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Not authenticated" });
  }
};

const requireDB = (req, res, next) => {
  if (!dbReady()) {
    return res.status(503).json({ error: "Persistence is not configured (MONGODB_URI)" });
  }
  next();
};

module.exports = { requireAuth, requireDB };
