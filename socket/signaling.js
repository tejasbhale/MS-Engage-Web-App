//Socket layer: WebRTC signaling (unchanged semantics) + call-lifecycle
//persistence. Sockets are authenticated from the same JWT session cookie the
//REST API uses — identity (chat names, caption speakers, participants) is
//stamped server-side from the verified session, never trusted from the client.

const jwt = require("jsonwebtoken");

//Minimal cookie-header parser (only need the session cookie's value).
const parseCookies = (header) =>
  Object.fromEntries(
    (header || "")
      .split(";")
      .map((part) => {
        const i = part.indexOf("=");
        if (i === -1) return null;
        return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
      })
      .filter(Boolean)
  );

const { JWT_SECRET, SESSION_COOKIE } = require("../config");
const { dbReady, User, Call } = require("../db");
const { summarizeAndExtract } = require("../summarize");

//Ends a call document exactly once (whoever reports the end first wins) and
//runs the summarization pipeline over the persisted transcript. Clients are
//notified via the change stream / their pending-summary polling.
const endAndSummarize = async (callId) => {
  if (!dbReady() || !callId) return;
  try {
    const now = new Date();
    const call = await Call.findOneAndUpdate(
      { _id: callId, endedAt: null },
      { $set: { endedAt: now, summaryStatus: "pending", "participants.$[].leftAt": now } },
      { new: true }
    );
    if (!call) return; //already ended by the other side

    const transcriptText = call.transcript
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n")
      .trim();
    if (!transcriptText) {
      await Call.updateOne({ _id: callId }, { $set: { summaryStatus: "empty" } });
      return;
    }

    const result = await summarizeAndExtract(transcriptText);
    await Call.updateOne(
      { _id: callId },
      {
        $set: {
          summary: result.summary,
          summaryEngine: result.engine,
          summaryDegraded: result.degraded || "",
          summaryStatus: "done",
          actionItems: result.actionItems.map((a) => ({
            task: a.task,
            owner: a.owner || null,
            dueDate: a.dueDate || null,
            completed: false,
            updatedAt: new Date(),
          })),
        },
      }
    );
  } catch (err) {
    console.error("End-of-call summarization failed:", err.message);
    await Call.updateOne({ _id: callId }, { $set: { summaryStatus: "failed" } }).catch(() => {});
  }
};

//Strips control characters and caps length (explicit, no regex ranges).
const clean = (v, max) => {
  if (typeof v !== "string") return "";
  let out = "";
  for (const ch of v) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.slice(0, max);
};

//(Re)reads the socket's verified user from the DB and refreshes the cached
//identity (a user-chosen displayName wins over the Google name). Keyed by the
//session-verified email, so a client can trigger a refresh but can't choose
//the name. Safe to call any time — notably after a mid-session rename.
const resolveIdentity = async (socket) => {
  if (!socket.data.auth) return;
  const { email, name } = socket.data.auth;
  //Base identity synchronously so early events always carry a name.
  if (!socket.data.user) socket.data.user = { email, name, userId: null };
  if (!dbReady()) return;
  try {
    const doc = await User.findOneAndUpdate(
      { email },
      { $setOnInsert: { email, name, createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean();
    socket.data.user.userId = doc._id;
    socket.data.user.name = doc.displayName || doc.name || name;
    //Per-user room: scoped callUpdated events are emitted here (idempotent).
    socket.join(`user:${doc._id}`);
  } catch (err) {
    console.error("Socket user resolution failed:", err.message);
  }
};

const initSignaling = (io) => {
  //Authenticate sockets from the session cookie (sent because the client
  //connects withCredentials and CORS allows credentialed origins).
  io.use((socket, next) => {
    try {
      const cookies = parseCookies(socket.request.headers.cookie);
      const payload = jwt.verify(cookies[SESSION_COOKIE], JWT_SECRET);
      socket.data.auth = { email: payload.email, name: payload.name };
    } catch (err) {
      socket.data.auth = null; //unauthenticated (e.g. landing page) — allowed, but inert
    }
    next();
  });

  //Callers awaiting an answer, keyed by the callee's socket id.
  const pendingCalls = new Map();

  io.on("connection", (socket) => {
    socket.emit("me", socket.id); //Emits my ID as soon as the connection is opened.

    //Resolve identity in the background; the base name is set synchronously
    //inside resolveIdentity so early events still carry an identity.
    resolveIdentity(socket);

    //A client whose display name changed mid-session (rename, or entering a
    //room) asks the socket to re-read its identity from the DB.
    socket.on("refreshIdentity", () => resolveIdentity(socket));

    const identityName = () => (socket.data.user && socket.data.user.name) || "Guest";

    socket.on("disconnect", () => {
      //Socket Handler for disconnecting call
      socket.broadcast.emit("CallEnded");
      pendingCalls.delete(socket.id);
      if (socket.data.activeCallId) {
        endAndSummarize(socket.data.activeCallId);
        socket.data.activeCallId = null;
      }
    });

    socket.on("CallUser", ({ userToCall, signalData, from }) => {
      //Socket Handler for Calling user (name comes from the verified session)
      const name = identityName();
      pendingCalls.set(userToCall, { callerSocketId: from, callerName: name });
      io.to(userToCall).emit("CallUser", { signal: signalData, from, name });
    });

    socket.on("message", ({ message }) => {
      //Socket Handler for chat functionality. Sender identity is stamped
      //server-side; senderId lets clients lay out own/other messages.
      const text = clean(message, 1000);
      if (!text) return;
      io.emit("message", { senderId: socket.id, name: identityName(), message: text });
    });

    socket.on("caption", ({ text }) => {
      //Relays finalized live-caption lines; speaker is the verified identity.
      const line = clean(text, 2000);
      if (!line) return;
      const speaker = identityName();
      socket.broadcast.emit("caption", { speaker, text: line });
      //Append to the active call's transcript in the same document.
      if (dbReady() && socket.data.activeCallId) {
        Call.updateOne(
          { _id: socket.data.activeCallId, endedAt: null },
          { $push: { transcript: { speaker, text: line, timestamp: new Date() } } }
        ).catch((err) => console.error("Transcript append failed:", err.message));
      }
    });

    socket.on("AnswerCall", async (data) => {
      //Socket Handler for Answering the call. Send the answerer's (host's)
      //verified name back so the joiner can label the remote tile.
      io.to(data.to).emit("CallAccepted", { signal: data.signal, name: identityName() });

      //The call is live: create its document (one per call session).
      if (!dbReady()) return;
      try {
        const pending = pendingCalls.get(socket.id) || {};
        const callerSocket = io.sockets.sockets.get(data.to);
        const now = new Date();
        const me = socket.data.user || {};
        const caller = (callerSocket && callerSocket.data.user) || {};
        const call = await Call.create({
          roomId: socket.id, //room code = host's socket id
          startedAt: now,
          participants: [
            { userId: me.userId || null, name: me.name || "Host", joinedAt: now, leftAt: null },
            {
              userId: caller.userId || null,
              name: caller.name || pending.callerName || "Guest",
              joinedAt: now,
              leftAt: null,
            },
          ],
        });
        socket.data.activeCallId = call._id;
        if (callerSocket) callerSocket.data.activeCallId = call._id;
        //Tell both sides which document this call lives in.
        const payload = { callId: String(call._id) };
        socket.emit("callStarted", payload);
        io.to(data.to).emit("callStarted", payload);
        pendingCalls.delete(socket.id);
      } catch (err) {
        console.error("Call document creation failed:", err.message);
      }
    });

    //A participant clicked Leave: end the call for everyone and summarize once.
    socket.on("EndCall", () => {
      socket.broadcast.emit("CallEnded");
      if (socket.data.activeCallId) {
        const callId = socket.data.activeCallId;
        socket.data.activeCallId = null;
        endAndSummarize(callId);
      }
    });
  });
};

module.exports = { initSignaling };
