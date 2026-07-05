//Recent meetings list backed by GET /history, with the meeting-detail
//drawer. Shared by the Home page and the /history page.

import React, { useState, useEffect, useCallback } from "react";

import { socket } from "../SocketContext";
import MeetingDrawer from "./MeetingDrawer";
import { apiFetch } from "../api";

const HUES = ["oklch(0.66 0.13 40)", "oklch(0.60 0.12 248)"];

const formatWhen = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` · ${time}`;
};

const RecentMeetings = ({ myName }) => {
  const [calls, setCalls] = useState(null); //null = loading
  const [note, setNote] = useState(null);
  const [openCallId, setOpenCallId] = useState(null);

  const load = useCallback(() => {
    apiFetch("/history")
      .then(async (res) => {
        if (res.status === 503) {
          setCalls([]);
          setNote("Meeting history needs a database — set MONGODB_URI on the server.");
          return;
        }
        if (!res.ok) throw new Error("Could not load history");
        const data = await res.json();
        setCalls(data.calls);
        setNote(null);
      })
      .catch(() => {
        setCalls([]);
        setNote("Could not load meeting history.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  //A summary landed or items changed somewhere → refresh the list.
  useEffect(() => {
    const onUpdate = () => load();
    socket.on("callUpdated", onUpdate);
    return () => socket.off("callUpdated", onUpdate);
  }, [load]);

  const title = (call) => {
    const others = call.participants.filter((p) => p !== myName);
    return others.length ? others.join(" & ") : call.participants.join(" & ") || "Meeting";
  };

  return (
    <>
      <div className="hm-recents">
        {calls === null && <div className="hm-recents-note">Loading…</div>}
        {calls !== null && calls.length === 0 && (
          <div className="hm-recents-note">{note || "No meetings yet — start one above."}</div>
        )}
        {(calls || []).map((call, i) => (
          <button
            className="hm-meeting"
            key={call.callId}
            onClick={() => setOpenCallId(call.callId)}
            type="button"
          >
            <div className="hm-meeting-avatar" style={{ background: HUES[i % 2] }}>
              {title(call)[0].toUpperCase()}
            </div>
            <div className="hm-meeting-body">
              <div className="hm-meeting-title-row">
                <span className="hm-meeting-title">{title(call)}</span>
                <span className="hm-meeting-when">{formatWhen(call.startedAt)}</span>
              </div>
              <div className="hm-meeting-summary">
                {call.summaryStatus === "pending"
                  ? "Summary is being generated…"
                  : call.summaryPreview || "No summary available."}
              </div>
            </div>
            <div className="hm-meeting-pill">
              <span className="msr">check_circle</span>
              {call.actionItemsDone}/{call.actionItemsTotal} action items
            </div>
          </button>
        ))}
      </div>
      <MeetingDrawer callId={openCallId} onClose={() => setOpenCallId(null)} />
    </>
  );
};

export default RecentMeetings;
