//Meeting history + action-item routes. Access control: a call is only
//visible/editable to its participants — every handler verifies membership
//before returning or mutating anything (no cross-user access by guessing ids).

const express = require("express");

const { requireAuth, requireDB } = require("../middleware/auth");
const { User, Call, callUpdatePayload } = require("../db");

const router = express.Router();

//True when the requesting user is a participant of the call. Matches by
//userId (canonical); falls back to name matching only for legacy documents
//created before sockets were authenticated.
const isParticipant = async (call, reqUser) => {
  const userDoc = await User.findOne({ email: reqUser.email }).lean();
  return call.participants.some((p) => {
    if (p.userId && userDoc) return String(p.userId) === String(userDoc._id);
    return p.name === reqUser.name || (userDoc && p.name === userDoc.displayName);
  });
};

//Past calls for the signed-in user, newest first.
router.get("/history", requireAuth, requireDB, async (req, res) => {
  try {
    const userDoc = await User.findOne({ email: req.user.email }).lean();
    const or = [{ "participants.name": req.user.name }];
    if (userDoc) {
      or.push({ "participants.userId": userDoc._id });
      if (userDoc.displayName) or.push({ "participants.name": userDoc.displayName });
    }
    const calls = await Call.find({ $or: or }).sort({ startedAt: -1 }).limit(30).lean();

    //Resolve participants to their CURRENT names so a display-name change is
    //reflected retroactively across past meetings. Look up every participant
    //account once; fall back to the stored snapshot for guests without one.
    const userIds = [
      ...new Set(
        calls.flatMap((c) => c.participants.map((p) => p.userId).filter(Boolean).map(String))
      ),
    ];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const currentNameById = new Map(users.map((u) => [String(u._id), u.displayName || u.name]));
    const currentName = (p) =>
      (p.userId && currentNameById.get(String(p.userId))) || p.name;

    return res.json({
      calls: calls.map((c) => ({
        callId: String(c._id),
        roomId: c.roomId,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        participants: c.participants.map(currentName),
        summaryPreview: (c.summary || "").slice(0, 140),
        summaryStatus: c.summaryStatus,
        actionItemsTotal: c.actionItems.length,
        actionItemsDone: c.actionItems.filter((a) => a.completed).length,
      })),
    });
  } catch (err) {
    console.error("History fetch failed:", err.message);
    return res.status(500).json({ error: "Could not load history" });
  }
});

router.get("/calls/:callId", requireAuth, requireDB, async (req, res) => {
  try {
    const call = await Call.findById(req.params.callId).lean();
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await isParticipant(call, req.user))) {
      return res.status(403).json({ error: "Not a participant of this call" });
    }
    return res.json(callUpdatePayload(call));
  } catch (err) {
    return res.status(400).json({ error: "Invalid call id" });
  }
});

//Field validators for action-item updates.
const cleanString = (v, max) =>
  typeof v === "string" ? v.replace(/[\x00-\x1F\x7F]/g, "").slice(0, max) : undefined;

//Loads a call and asserts the requester is a participant. Returns the lean
//doc, or sends the appropriate error and returns null.
const loadCallForParticipant = async (req, res) => {
  const call = await Call.findById(req.params.callId).lean();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return null;
  }
  if (!(await isParticipant(call, req.user))) {
    res.status(403).json({ error: "Not a participant of this call" });
    return null;
  }
  return call;
};

//Edit the meeting summary text (manual correction of the AI output).
router.patch("/calls/:callId", requireAuth, requireDB, async (req, res) => {
  const summary = cleanString(req.body.summary, 5000);
  if (summary === undefined) {
    return res.status(400).json({ error: "Missing summary" });
  }
  try {
    if (!(await loadCallForParticipant(req, res))) return undefined;
    await Call.updateOne({ _id: req.params.callId }, { $set: { summary } });
    return res.json({ summary });
  } catch (err) {
    return res.status(400).json({ error: "Invalid call id" });
  }
});

//Add a blank action item (manual entry). Returns it with its generated _id.
router.post("/calls/:callId/action-items", requireAuth, requireDB, async (req, res) => {
  try {
    if (!(await loadCallForParticipant(req, res))) return undefined;
    const item = {
      task: cleanString(req.body.task, 500) || "",
      owner: cleanString(req.body.owner, 80) || null,
      dueDate: cleanString(req.body.dueDate, 80) || null,
      completed: false,
      updatedAt: new Date(),
    };
    const call = await Call.findByIdAndUpdate(
      req.params.callId,
      { $push: { actionItems: item } },
      { new: true }
    ).lean();
    return res.json({ actionItem: call.actionItems[call.actionItems.length - 1] });
  } catch (err) {
    return res.status(400).json({ error: "Invalid call id" });
  }
});

//Updates a single action item's fields; the change stream then fans the new
//state out to the other participants' open tabs.
router.patch(
  "/calls/:callId/action-items/:actionItemId",
  requireAuth,
  requireDB,
  async (req, res) => {
    const updates = {};
    const task = cleanString(req.body.task, 500);
    const owner = cleanString(req.body.owner, 80);
    const dueDate = cleanString(req.body.dueDate, 80);
    if (task !== undefined) updates["actionItems.$.task"] = task;
    if (owner !== undefined) updates["actionItems.$.owner"] = owner;
    if (dueDate !== undefined) updates["actionItems.$.dueDate"] = dueDate;
    if (typeof req.body.completed === "boolean") {
      updates["actionItems.$.completed"] = req.body.completed;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }
    updates["actionItems.$.updatedAt"] = new Date();

    try {
      const existing = await Call.findById(req.params.callId).lean();
      if (!existing) return res.status(404).json({ error: "Call not found" });
      if (!(await isParticipant(existing, req.user))) {
        return res.status(403).json({ error: "Not a participant of this call" });
      }
      const call = await Call.findOneAndUpdate(
        { _id: req.params.callId, "actionItems._id": req.params.actionItemId },
        { $set: updates },
        { new: true }
      ).lean();
      if (!call) return res.status(404).json({ error: "Action item not found" });
      const item = call.actionItems.find((a) => String(a._id) === req.params.actionItemId);
      return res.json({ actionItem: item });
    } catch (err) {
      return res.status(400).json({ error: "Invalid id" });
    }
  }
);

module.exports = router;
