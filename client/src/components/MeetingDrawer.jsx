//Slide-over drawer showing one past meeting: read-only summary + the
//interactive action-item checklist. Opens over the page (no navigation);
//edits persist on change, so closing discards nothing. Live "callUpdated"
//socket events keep the drawer in sync across tabs.

import React, { useState, useEffect } from "react";

import { socket } from "../SocketContext";
import ActionItemsEditor from "./ActionItemsEditor";
import SummaryEditor from "./SummaryEditor";
import { apiFetch } from "../api";
import "./MeetingDrawer.css";

const MeetingDrawer = ({ callId, onClose }) => {
  const [call, setCall] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!callId) return;
    setCall(null);
    setError(null);
    apiFetch(`/calls/${callId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load meeting"))))
      .then(setCall)
      .catch((err) => setError(err.message));
  }, [callId]);

  //Another tab edited this meeting → refresh our copy (the editor merges
  //without clobbering fields being typed in here).
  useEffect(() => {
    if (!callId) return;
    const onUpdate = (payload) => {
      if (payload.callId === callId) setCall(payload);
    };
    socket.on("callUpdated", onUpdate);
    return () => socket.off("callUpdated", onUpdate);
  }, [callId]);

  if (!callId) return null;

  return (
    <div className="md-overlay" onClick={onClose}>
      <div className="md-panel" onClick={(e) => e.stopPropagation()}>
        <div className="md-head">
          <span className="md-title">Meeting summary</span>
          <button className="md-close" onClick={onClose} title="Close" type="button">
            <span className="msr">close</span>
          </button>
        </div>

        <div className="md-body">
          {error && <p className="md-text">{error}</p>}
          {!call && !error && <p className="md-text">Loading…</p>}
          {call && (
            <>
              <div className="md-label">Summary</div>
              {call.summaryStatus === "pending" ? (
                <p className="md-text">Summary is still being generated…</p>
              ) : (
                //Editable — manual corrections to the AI summary autosave.
                <SummaryEditor
                  callId={callId}
                  summary={call.summary}
                  placeholder={
                    call.summaryStatus === "empty"
                      ? "No transcript was captured — write a summary if you like…"
                      : "Add a summary…"
                  }
                />
              )}
              <div className="md-label">Action items</div>
              <ActionItemsEditor callId={callId} items={call.actionItems} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MeetingDrawer;
