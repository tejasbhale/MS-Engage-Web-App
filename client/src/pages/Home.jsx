//Connect.Two Home — post-sign-in home base (from the other_pages handoff).
//Start a meeting, join by code/link, and (sample-data) recent meetings.

import React, { useState } from "react";
import { useHistory } from "react-router-dom";

import { useAuth } from "../AuthContext";
import RecentMeetings from "../components/RecentMeetings";
import "./Home.css";

//"code or link" — accept a bare room code or a pasted /room/<code> URL.
const parseRoomCode = (raw) => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/\/room\/([^/?#\s]+)/);
  return match ? match[1] : trimmed;
};

const Home = () => {
  const history = useHistory();
  const { user, logout, updateName } = useAuth();
  const [code, setCode] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const startNameEdit = () => {
    setNameDraft(user?.name || "");
    setEditingName(true);
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === user?.name) return;
    try {
      await updateName(next);
    } catch (err) {
      alert(err.message);
    }
  };

  const firstName = (user?.name || "there").split(" ")[0];
  const initials = (user?.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  const startMeeting = () => history.push("/room/new");

  const join = () => {
    const roomCode = parseRoomCode(code);
    if (roomCode) history.push(`/room/${roomCode}`);
  };

  const signOut = async () => {
    await logout();
    history.push("/");
  };

  return (
    <div className="hm-page">
      <header className="hm-header">
        <div className="ct-wordmark">
          <div className="ct-mark">
            <div className="ct-mark-dot ct-mark-dot--blue" />
            <div className="ct-mark-dot ct-mark-dot--coral" />
          </div>
          <span className="ct-wordmark-text">
            Connect<span>.Two</span>
          </span>
        </div>
        <div className="hm-user">
          <div className="hm-user-id">
            <div className="hm-avatar">{initials}</div>
            {editingName ? (
              <input
                className="hm-name-input"
                value={nameDraft}
                autoFocus
                maxLength={40}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
              />
            ) : (
              <>
                <span className="hm-user-name">{user?.name}</span>
                <button
                  className="hm-name-edit"
                  title="Edit display name"
                  onClick={startNameEdit}
                  type="button"
                >
                  <span className="msr">edit</span>
                </button>
              </>
            )}
          </div>
          <button className="hm-signout" title="Sign out" onClick={signOut} type="button">
            <span className="msr">logout</span>
          </button>
        </div>
      </header>

      <main className="hm-main">
        <div className="hm-greeting">
          <h1 className="hm-h1">
            Good {part}, {firstName}.
          </h1>
          <p className="hm-sub">Start a call and it takes the notes for you.</p>
        </div>

        <div className="hm-card">
          <button className="hm-start" onClick={startMeeting} type="button">
            <span className="msr">videocam</span>
            Start a meeting
          </button>

          <div className="hm-divider">
            <div className="hm-divider-line" />
            <span>or join one</span>
            <div className="hm-divider-line" />
          </div>

          <div className="hm-join-row">
            <div className="hm-code-field">
              <span className="msr">tag</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && join()}
                placeholder="Enter a room code or link"
              />
            </div>
            <button className="hm-join" onClick={join} type="button">
              Join
              <span className="msr">arrow_forward</span>
            </button>
          </div>
        </div>

        <div className="hm-recent-head">
          <h2>Recent meetings</h2>
          <button className="hm-viewall" onClick={() => history.push("/history")} type="button">
            View all
            <span className="msr">arrow_forward</span>
          </button>
        </div>

        <RecentMeetings myName={user?.name} />
      </main>

      <footer className="hm-footer">Peer&#8209;to&#8209;peer &middot; end&#8209;to&#8209;end encrypted</footer>
    </div>
  );
};

export default Home;
