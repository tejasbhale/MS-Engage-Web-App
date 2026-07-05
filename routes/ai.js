//AI routes: ephemeral transcription tokens + the client-side summarize
//fallback (used only when persistence is off; persisted calls are
//summarized server-side at call end by the signaling layer).

const express = require("express");
const rateLimit = require("express-rate-limit");

const { ASSEMBLYAI_API_KEY } = require("../config");
const { requireAuth } = require("../middleware/auth");
const { summarizeAndExtract } = require("../summarize");

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

//Mints a short-lived AssemblyAI realtime token so the API key never reaches
//the browser; the client opens the transcription WebSocket with this token.
router.post("/ai/assemblyai-token", requireAuth, aiLimiter, async (req, res) => {
  if (!ASSEMBLYAI_API_KEY) {
    return res.status(503).json({ error: "ASSEMBLYAI_API_KEY is not configured on the server" });
  }
  try {
    const r = await fetch("https://api.assemblyai.com/v2/realtime/token", {
      method: "POST",
      headers: {
        authorization: ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expires_in: 600 }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("AssemblyAI token request failed:", r.status, detail);
      return res.status(502).json({ error: "Could not obtain transcription token" });
    }
    const { token } = await r.json();
    return res.json({ token });
  } catch (err) {
    console.error("AssemblyAI token error:", err.message);
    return res.status(502).json({ error: "Could not obtain transcription token" });
  }
});

//Runs the LangChain summarization pipeline over a transcript supplied by the
//client. Fallback path for non-persisted calls.
router.post("/ai/summarize", requireAuth, aiLimiter, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "Missing transcript" });
  }
  try {
    const result = await summarizeAndExtract(transcript.slice(0, 200000));
    return res.json(result);
  } catch (err) {
    console.error("Summarization failed:", err.message);
    return res.status(500).json({ error: "Summarization failed" });
  }
});

module.exports = router;
