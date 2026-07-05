//Composition root: assembles config, middleware, routes, sockets, and the
//database. Feature logic lives in the modules it belongs to:
//  config.js            — env/configuration
//  db.js                — models, connection, change stream
//  middleware/auth.js   — request guards
//  routes/auth.js       — Google sign-in, session, profile
//  routes/calls.js      — meeting history + action items
//  routes/ai.js         — transcription tokens + summarize fallback
//  socket/signaling.js  — WebRTC signaling + call lifecycle
//  summarize.js         — LangChain summarization pipeline

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { PORT, ALLOWED_ORIGINS } = require("./config");
const { connectDB, initChangeStream } = require("./db");
const authRoutes = require("./routes/auth");
const callRoutes = require("./routes/calls");
const aiRoutes = require("./routes/ai");
const { initSignaling } = require("./socket/signaling");

const app = express();
const server = require("http").createServer(app);

//Sockets share the credentialed CORS policy — the session cookie rides the
//handshake so socket connections carry a verified identity.
const io = require("socket.io")(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" })); //call transcripts can be long
app.use(cookieParser());

app.use(authRoutes);
app.use(callRoutes);
app.use(aiRoutes);

app.get("/", (req, res) => {
  res.send("Server running");
});

initSignaling(io);

connectDB().then((ok) => {
  if (ok) initChangeStream(io);
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
