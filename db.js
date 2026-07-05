//MongoDB persistence layer: users + calls collections (Mongoose), plus a
//change stream that pushes call updates to connected Socket.IO clients.
//Everything degrades gracefully when MONGODB_URI is unset or unreachable —
//the app keeps working with client-side (non-persisted) summaries.

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  googleId: { type: String, index: true },
  email: { type: String, index: true },
  name: String,
  //User-chosen display name; when set it is used across the app instead of
  //the Google account name.
  displayName: { type: String, default: null },
  avatarUrl: String,
  createdAt: { type: Date, default: Date.now },
});

const callSchema = new mongoose.Schema({
  roomId: String,
  participants: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name: String,
      joinedAt: Date,
      leftAt: Date,
    },
  ],
  startedAt: Date,
  endedAt: { type: Date, default: null },
  transcript: [{ speaker: String, text: String, timestamp: Date }],
  summary: { type: String, default: "" },
  summaryEngine: { type: String, default: "" },
  //Non-empty when Gemini was attempted but failed (quota, network, etc.) and
  //the heuristic summary was used instead — surfaced to the user.
  summaryDegraded: { type: String, default: "" },
  //pending → the call ended and the pipeline is running; done/empty/failed.
  summaryStatus: { type: String, default: "" },
  actionItems: [
    {
      task: String,
      owner: { type: String, default: null },
      dueDate: { type: String, default: null },
      completed: { type: Boolean, default: false },
      updatedAt: Date,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Call = mongoose.model("Call", callSchema);

let ready = false;
const dbReady = () => ready;

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.warn("MONGODB_URI not set — running without persistence.");
    return false;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
    ready = true;
    console.log("MongoDB connected");
    return true;
  } catch (err) {
    console.error("MongoDB connection failed — running without persistence:", err.message);
    return false;
  }
};

//The payload clients need to render summaries/action items live.
const callUpdatePayload = (doc) => ({
  callId: String(doc._id),
  roomId: doc.roomId,
  summary: doc.summary,
  summaryEngine: doc.summaryEngine,
  summaryDegraded: doc.summaryDegraded,
  summaryStatus: doc.summaryStatus,
  endedAt: doc.endedAt,
  actionItems: doc.actionItems,
});

//Watch the calls collection and fan out relevant changes over Socket.IO so
//open drawers/summary screens update live. Requires a replica set (Atlas M0
//supports change streams); if unavailable we log and move on — clients still
//poll while a summary is pending, so nothing breaks.
//Updates are emitted ONLY to the call's participants (their user:<id> rooms,
//joined by authenticated sockets) — never broadcast to everyone.
const initChangeStream = (io) => {
  if (!ready) return;
  try {
    const stream = Call.watch([], { fullDocument: "updateLookup" });
    stream.on("change", (change) => {
      if (change.operationType !== "update" && change.operationType !== "replace") return;
      //Ignore transcript-append noise; only fan out summary/action-item/state changes.
      const updated = Object.keys(change.updateDescription?.updatedFields || {});
      const relevant = updated.some((k) =>
        /^(summary|summaryEngine|summaryStatus|actionItems|endedAt)/.test(k)
      );
      if (!relevant || !change.fullDocument) return;
      const payload = callUpdatePayload(change.fullDocument);
      change.fullDocument.participants.forEach((p) => {
        if (p.userId) io.to(`user:${p.userId}`).emit("callUpdated", payload);
      });
    });
    stream.on("error", (err) => {
      console.warn("Change stream error (live updates disabled):", err.message);
    });
    console.log("MongoDB change stream watching calls collection");
  } catch (err) {
    console.warn("Change streams unavailable (live updates disabled):", err.message);
  }
};

module.exports = { connectDB, dbReady, initChangeStream, callUpdatePayload, User, Call };
