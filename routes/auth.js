//Authentication + profile routes. Google ID-token verification issues a
//1-day JWT session cookie; /auth/me resolves the effective identity
//(user-chosen displayName wins over the Google name) and its expiry so the
//client can auto-log-out.

const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");

const { JWT_SECRET, GOOGLE_CLIENT_ID, SESSION_COOKIE, SESSION_TTL_MS, IS_PROD } = require("../config");
const { requireAuth, requireDB } = require("../middleware/auth");
const { dbReady, User } = require("../db");

const router = express.Router();
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const cookieOptions = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax",
};

//Effective display name for an email (displayName beats the Google name).
const resolveDisplayName = async (email, fallback) => {
  if (!dbReady()) return fallback;
  try {
    const doc = await User.findOne({ email }).lean();
    return (doc && doc.displayName) || fallback;
  } catch (err) {
    return fallback;
  }
};

router.post("/auth/google", authLimiter, async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: "Missing Google credential" });
  }
  if (!GOOGLE_CLIENT_ID || !JWT_SECRET) {
    return res.status(500).json({ error: "Server is missing GOOGLE_CLIENT_ID or JWT_SECRET" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    //Persist/refresh the user record (keyed by Google account id).
    if (dbReady()) {
      await User.findOneAndUpdate(
        { googleId: payload.sub },
        {
          $set: { email: payload.email, name: payload.name, avatarUrl: payload.picture },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      ).catch((err) => console.error("User upsert failed:", err.message));
    }

    const identity = { email: payload.email, name: payload.name, picture: payload.picture };
    const token = jwt.sign(identity, JWT_SECRET, { expiresIn: Math.floor(SESSION_TTL_MS / 1000) });

    res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });

    const name = await resolveDisplayName(payload.email, payload.name);
    return res.json({ user: { ...identity, name } });
  } catch (err) {
    console.error("Google token verification failed:", err.message);
    return res.status(401).json({ error: "Invalid Google ID token" });
  }
});

//The session cookie is httpOnly, so the client can't inspect it — this
//endpoint is how the frontend answers "am I authenticated, as whom, until when?".
router.get("/auth/me", async (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const name = await resolveDisplayName(payload.email, payload.name);
    return res.json({
      user: { email: payload.email, name, picture: payload.picture },
      expiresAt: payload.exp * 1000,
    });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
});

//Profile: update the display name used across the app.
router.patch("/auth/me", requireAuth, requireDB, async (req, res) => {
  const raw = req.body.name;
  if (typeof raw !== "string") {
    return res.status(400).json({ error: "Missing name" });
  }
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\x00-\x1F\x7F]/g, "").trim();
  if (name.length < 1 || name.length > 40) {
    return res.status(400).json({ error: "Name must be 1-40 characters" });
  }
  try {
    await User.findOneAndUpdate(
      { email: req.user.email },
      {
        $set: { displayName: name },
        $setOnInsert: { email: req.user.email, name: req.user.name, createdAt: new Date() },
      },
      { upsert: true }
    );
    return res.json({ user: { email: req.user.email, name, picture: req.user.picture } });
  } catch (err) {
    console.error("Display name update failed:", err.message);
    return res.status(500).json({ error: "Could not update name" });
  }
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  return res.json({ ok: true });
});

module.exports = router;
