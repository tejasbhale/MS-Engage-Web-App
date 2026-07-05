//Central configuration — the single place env vars are read.

require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: process.env.JWT_SECRET,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
  ALLOWED_ORIGINS: (
    process.env.CLIENT_ORIGIN || "http://localhost:3000,https://localhost:3000"
  ).split(","),
  SESSION_COOKIE: "session",
  //Sessions last one day: signed into the JWT and mirrored on the cookie.
  SESSION_TTL_MS: 24 * 60 * 60 * 1000,
  IS_PROD: process.env.NODE_ENV === "production",
};
