//Connect.Two Room — the in-call screen (from the other_pages handoff), wired
//to the existing WebRTC/socket logic in SocketContext (which is unchanged).
//
//Room-code model: the signaling is socket-ID based, so the room code IS the
//host's socket ID. /room/new = host a room (code appears once connected);
///room/<code> = auto-call that ID on entry.
//
//AI pipeline: while the call runs, a transcriber (AssemblyAI realtime or the
//Web Speech API, per REACT_APP_TRANSCRIPTION_MODE) feeds live captions into
//the drawer and accumulates the full transcript; when the call ends the
//transcript goes to the server's LangChain pipeline and the summary screen
//shows the result.

import React, { useContext, useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";

import { ContextProvider, SocketContext, socket } from "../SocketContext";
import { useAuth } from "../AuthContext";
import { createTranscriber, getTranscriptionMode } from "../ai/transcription";
import ActionItemsEditor from "../components/ActionItemsEditor";
import SummaryEditor from "../components/SummaryEditor";
import { apiFetch, apiJson } from "../api";
import "./Room.css";

const BLUE = "oklch(0.68 0.12 248)";
const CORAL = "oklch(0.72 0.13 40)";

const formatTime = (totalSeconds) => {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

//Post-call screen: the generated summary + action-item checklist. When the
//call was persisted (callId set), the checklist is the same autosaving
//editor used in the history drawer; otherwise it's a local-only list.
const SummaryScreen = ({ summary, callId, onDone }) => {
  const [checked, setChecked] = useState({});
  const toggle = (i) => setChecked((c) => ({ ...c, [i]: !c[i] }));

  const owners = summary.data
    ? [...new Set(summary.data.actionItems.map((a) => a.owner).filter(Boolean))]
    : [];
  const ownerHue = (owner) =>
    owners.indexOf(owner) % 2 === 0 ? "rm-sum-pill--blue" : "rm-sum-pill--coral";

  return (
    <div className="rm-sum-wrap">
      <div className="rm-sum-card">
        <div className="rm-sum-head">
          <span className="rm-sum-title">Summary</span>
          <span className="rm-sum-meta">
            {summary.loading ? "generating…" : "delivered · just now"}
          </span>
        </div>

        {summary.loading && (
          <div className="rm-sum-loading">
            <span className="rm-captions-dot" />
            Summarizing your meeting…
          </div>
        )}

        {summary.error && (
          <p className="rm-sum-body">
            Couldn&rsquo;t generate a summary: {summary.error}
          </p>
        )}

        {summary.empty && (
          <p className="rm-sum-body">
            No transcript was captured during this call, so there&rsquo;s nothing to
            summarize.
          </p>
        )}

        {summary.data && (
          <>
            {callId ? (
              <SummaryEditor callId={callId} summary={summary.data.summary} />
            ) : (
              <p className="rm-sum-body">{summary.data.summary}</p>
            )}
            <div className="rm-sum-label">Action items</div>
            {callId ? (
              <ActionItemsEditor callId={callId} items={summary.data.actionItems} />
            ) : summary.data.actionItems.length === 0 ? (
              <p className="rm-sum-none">No action items were detected.</p>
            ) : (
              <div className="rm-sum-items">
                {summary.data.actionItems.map((item, i) => (
                  <button
                    className="rm-sum-item"
                    key={i}
                    onClick={() => toggle(i)}
                    type="button"
                  >
                    <span className={`rm-sum-check${checked[i] ? " rm-sum-check--done" : ""}`}>
                      {checked[i] && <span className="msr">check</span>}
                    </span>
                    <span className={`rm-sum-task${checked[i] ? " rm-sum-task--done" : ""}`}>
                      {item.task}
                      {item.dueDate && <span className="rm-sum-due"> · due {item.dueDate}</span>}
                    </span>
                    {item.owner && (
                      <span className={`rm-sum-pill ${ownerHue(item.owner)}`}>{item.owner}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {summary.data.engine === "fallback" && (
              <div className="rm-sum-note">
                {summary.data.degraded
                  ? "Using heuristic summary, as the Gemini summary is not responding."
                  : "Heuristic summary — set GOOGLE_API_KEY on the server for AI summaries."}
              </div>
            )}
          </>
        )}

        <div className="rm-sum-actions">
          <button className="rm-sum-done" onClick={onDone} type="button">
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
};

const RoomInner = () => {
  const { roomId } = useParams();
  const { user } = useAuth();
  const {
    call,
    CallAccepted,
    myVideo,
    userVideo,
    stream,
    setName,
    CallEnded,
    me,
    CallUser,
    endCall,
    AnswerCall,
  } = useContext(SocketContext);

  //Mic and camera start OFF by default (matches the disabled tracks the
  //SocketContext hands us); the user turns them on from the controls.
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [panel, setPanel] = useState(null); //null | 'captions' | 'chat'
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  //AI pipeline state.
  const [phase, setPhase] = useState("call"); //'call' | 'summary'
  const [captions, setCaptions] = useState([]); //{speaker, text, mine}
  const [partial, setPartial] = useState(null);
  const [summary, setSummary] = useState({ loading: false });
  const [callId, setCallId] = useState(null); //MongoDB call document id
  const transcriberRef = useRef(null);
  const captionsListRef = useRef(null);
  const summaryDoneRef = useRef(false);

  const isHost = roomId === "new";
  const roomCode = isHost ? me : roomId;
  const inCall = CallAccepted && !CallEnded;

  //Identify ourselves to the signaling layer with the Google account name.
  useEffect(() => {
    setName(user?.name || "Guest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  //The socket authenticates itself via the session cookie on its handshake.
  //Refresh its cached identity on room entry (and any reconnect) so a display
  //name changed mid-session is reflected in chat, captions, the calling
  //dialog, and the persisted participant list.
  useEffect(() => {
    const refresh = () => socket.emit("refreshIdentity");
    refresh();
    socket.on("connect", refresh);
    return () => socket.off("connect", refresh);
  }, []);

  //The server creates the call document when the call is answered and tells
  //both sides its id.
  useEffect(() => {
    const onStarted = ({ callId: id }) => setCallId(id);
    socket.on("callStarted", onStarted);
    return () => socket.off("callStarted", onStarted);
  }, []);

  //Joiner: place the call once our media and socket ID are ready.
  const calledRef = useRef(false);
  useEffect(() => {
    if (!isHost && me && stream && !calledRef.current && !call.isReceivingCall) {
      calledRef.current = true;
      CallUser(roomId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, stream]);

  //Elapsed-time chip. Runs only during the live call — the moment the meeting
  //ends (phase leaves "call") the interval is cleared and the time freezes.
  useEffect(() => {
    if (phase !== "call") return undefined;
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  //Chat rides the existing "message" socket event (the server echoes to
  //everyone, so we render on echo rather than appending locally on send).
  //The server stamps the verified sender name and socket id on each message.
  useEffect(() => {
    const onMessage = ({ senderId, name: from, message }) => {
      setMessages((prev) => [...prev, { senderId, who: from, text: message }]);
    };
    socket.on("message", onMessage);
    return () => socket.off("message", onMessage);
  }, []);

  //Live transcription runs ONLY while the mic is on. A muted user is never
  //recorded: the transcriber (and its microphone access) is torn down on mute
  //and recreated on unmute, so no speech is captioned, relayed, or persisted
  //while muted. The full transcript still survives across mute/unmute cycles —
  //the server accumulates the emitted captions and the client mirrors every
  //finalized line in `captions` state (see captionsRef below).
  useEffect(() => {
    const shouldRun = inCall && micOn && stream && phase === "call";
    if (shouldRun && !transcriberRef.current) {
      const speaker = user?.name || "You";
      const transcriber = createTranscriber({
        mode: getTranscriptionMode(),
        stream,
        speaker,
        onSegment: (seg) => {
          if (seg.isFinal) {
            setPartial(null);
            setCaptions((prev) => [...prev, { speaker: seg.speaker, text: seg.text, mine: true }]);
            socket.emit("caption", { text: seg.text }); //speaker stamped server-side
          } else {
            setPartial({ speaker: seg.speaker, text: seg.text });
          }
        },
        onStatus: (s) => console.log("[transcription]", s),
      });
      transcriberRef.current = transcriber;
      transcriber.start();
    } else if (!shouldRun && transcriberRef.current) {
      //Muted or call ending — stop capturing at once and drop any in-progress
      //partial so a half-spoken word is neither shown nor sent.
      transcriberRef.current.stop();
      transcriberRef.current = null;
      setPartial(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCall, micOn, stream, phase]);

  //Remote captions: render them and fold them into the shared transcript.
  useEffect(() => {
    const onCaption = ({ speaker, text }) => {
      if (transcriberRef.current) transcriberRef.current.addExternalSegment(speaker, text);
      setCaptions((prev) => [...prev, { speaker, text, mine: false }]);
    };
    socket.on("caption", onCaption);
    return () => socket.off("caption", onCaption);
  }, []);

  //Mirror captions in a ref so the (non-persisted) fallback summary can build
  //the full transcript even across transcriber restarts on mute/unmute.
  const captionsRef = useRef([]);
  useEffect(() => {
    captionsRef.current = captions;
  }, [captions]);

  //Keep the captions stream pinned to the newest line.
  useEffect(() => {
    const el = captionsListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions, partial]);

  //Stop the transcriber if the room unmounts mid-call.
  useEffect(() => {
    return () => {
      if (transcriberRef.current) transcriberRef.current.stop();
    };
  }, []);

  const runSummary = async (transcript) => {
    if (!transcript.trim()) {
      setSummary({ loading: false, empty: true });
      return;
    }
    setSummary({ loading: true });
    try {
      const data = await apiJson("/ai/summarize", {
        method: "POST",
        body: JSON.stringify({ transcript }),
      });
      setSummary({ loading: false, data });
    } catch (err) {
      setSummary({ loading: false, error: err.message });
    }
  };

  //End of call → stop transcribing, tear down the peer in place, and get a
  //summary. Persisted calls (callId set) are summarized once on the server:
  //the initiator emits EndCall — the server ends the call for everyone,
  //runs the pipeline over the stored transcript, and both sides receive the
  //result. Without persistence we fall back to the client-side pipeline.
  const finishCall = (initiator = true) => {
    //Transcript for the non-persisted fallback comes from the mirrored
    //captions (survives mute/unmute), not the possibly-stopped transcriber.
    const transcript = captionsRef.current
      .map((c) => `${c.speaker}: ${c.text}`)
      .join("\n");
    if (transcriberRef.current) {
      transcriberRef.current.stop();
      transcriberRef.current = null;
    }
    endCall();
    setPhase("summary");
    if (callId) {
      if (initiator) socket.emit("EndCall");
      setSummary({ loading: true }); //populated via callUpdated/polling below
    } else {
      runSummary(transcript);
    }
  };
  const finishRef = useRef(finishCall);
  finishRef.current = finishCall;

  //If the other side hangs up (Leave click or disconnect), end on ours too.
  //Note: the server broadcasts CallEnded on any disconnect, so this is
  //guarded to only act while we're actually in a call.
  useEffect(() => {
    const onRemoteEnded = () => {
      if (CallAccepted && !CallEnded) finishRef.current(false);
    };
    socket.on("CallEnded", onRemoteEnded);
    return () => socket.off("CallEnded", onRemoteEnded);
  }, [CallAccepted, CallEnded]);

  //Server-driven summary for persisted calls: fetch once, listen for change
  //stream pushes, and poll as a safety net until a terminal state arrives.
  useEffect(() => {
    if (phase !== "summary" || !callId) return;
    summaryDoneRef.current = false;
    let cancelled = false;

    const apply = (doc) => {
      if (cancelled || !doc) return;
      if (doc.summaryStatus === "done" || (!doc.summaryStatus && doc.summary)) {
        summaryDoneRef.current = true;
        setSummary({
          loading: false,
          data: {
            summary: doc.summary,
            actionItems: doc.actionItems,
            engine: doc.summaryEngine,
            degraded: doc.summaryDegraded,
          },
        });
      } else if (doc.summaryStatus === "empty") {
        summaryDoneRef.current = true;
        setSummary({ loading: false, empty: true });
      } else if (doc.summaryStatus === "failed") {
        summaryDoneRef.current = true;
        setSummary({ loading: false, error: "Summary generation failed" });
      }
    };

    const fetchDoc = () =>
      apiFetch(`/calls/${callId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then(apply)
        .catch(() => {});

    fetchDoc();
    const onUpdate = (payload) => {
      if (payload.callId === callId) apply(payload);
    };
    socket.on("callUpdated", onUpdate);
    const iv = setInterval(() => {
      if (!summaryDoneRef.current) fetchDoc();
    }, 2500);

    return () => {
      cancelled = true;
      socket.off("callUpdated", onUpdate);
      clearInterval(iv);
    };
  }, [phase, callId]);

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    socket.emit("message", { message }); //sender identity is stamped server-side
    setDraft("");
  };

  const toggleMic = () => {
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = !micOn));
    setMicOn((v) => !v);
  };

  const toggleCam = () => {
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = !camOn));
    setCamOn((v) => !v);
  };

  const copyCode = () => {
    if (!roomCode) return;
    const link = `${window.location.origin}/room/${roomCode}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const leave = () => {
    if (inCall) {
      finishCall();
    } else {
      //Not connected yet: full navigation still releases camera + socket ID.
      window.location.href = "/home";
    }
  };

  const declineIncoming = () => {
    //Socket IDs can't be reused after a handshake; reloading grants a new one
    //(same semantics as the previous AlertDialog implementation).
    window.location.reload();
  };

  const togglePanel = (which) => setPanel((p) => (p === which ? null : which));

  const remoteName = call.name || "Guest";
  const myInitial = (user?.name || "?")[0].toUpperCase();

  if (phase === "summary") {
    return (
      <div className="rm-page">
        <div className="rm-top">
          <div className="rm-top-left">
            <div className="rm-mark">
              <div className="rm-mark-dot rm-mark-dot--blue" />
              <div className="rm-mark-dot rm-mark-dot--coral" />
            </div>
            <span className="rm-title">Meeting ended</span>
          </div>
          <div className="rm-status">
            <span className="rm-status-time">{formatTime(seconds)} · ended</span>
          </div>
        </div>
        <SummaryScreen
          summary={summary}
          callId={callId}
          onDone={() => {
            window.location.href = "/home";
          }}
        />
      </div>
    );
  }

  return (
    <div className="rm-page">
      <div className="rm-top">
        <div className="rm-top-left">
          <div className="rm-mark">
            <div className="rm-mark-dot rm-mark-dot--blue" />
            <div className="rm-mark-dot rm-mark-dot--coral" />
          </div>
          <span className="rm-title">Meeting</span>
          <button
            className="rm-code"
            title={roomCode ? "Copy room link" : "Connecting…"}
            onClick={copyCode}
            type="button"
            data-room-code={roomCode || ""}
          >
            <span className="rm-code-text">{roomCode || "connecting…"}</span>
            <span className="msr">{copied ? "check" : "content_copy"}</span>
          </button>
        </div>
        <div className="rm-status">
          <span className="rm-status-dot" />
          <span className="rm-status-time">{formatTime(seconds)}</span>
        </div>
      </div>

      <div className="rm-content">
        <div className="rm-stage">
          <div className="rm-remote">
            {/* Always mounted so SocketContext can attach the remote stream. */}
            <video
              className="rm-video"
              playsInline
              autoPlay
              ref={userVideo}
              style={{ display: inCall ? "block" : "none" }}
            />
            {!inCall && (
              <div className="rm-remote-fallback">
                <div className="rm-remote-avatar">{isHost ? "…" : "S"}</div>
                <div className="rm-waiting">
                  {isHost
                    ? "Share the room code — waiting for someone to join"
                    : "Calling…"}
                </div>
              </div>
            )}
            {inCall && (
              <div className="rm-name-chip">
                <span>{remoteName}</span>
                <span className="msr">mic</span>
              </div>
            )}
          </div>

          <div className="rm-pip">
            {/* Always mounted so SocketContext can attach the local stream. */}
            <video
              className="rm-video"
              playsInline
              muted
              autoPlay
              ref={myVideo}
              style={{ display: camOn && stream ? "block" : "none" }}
            />
            {(!camOn || !stream) && <div className="rm-pip-avatar">{myInitial}</div>}
            <div className="rm-pip-label">
              <span>You</span>
              <span className={`msr${micOn ? "" : " rm-mic-off"}`}>
                {micOn ? "mic" : "mic_off"}
              </span>
            </div>
          </div>
        </div>

        <div className={`rm-rail${panel ? " rm-rail--open" : ""}`}>
          <div className="rm-panel">
            <div className="rm-panel-head">
              <div className="rm-tabs">
                <button
                  className={`rm-tab${panel === "captions" ? " rm-tab--active" : ""}`}
                  onClick={() => setPanel("captions")}
                  type="button"
                >
                  Captions
                </button>
                <button
                  className={`rm-tab${panel === "chat" ? " rm-tab--active" : ""}`}
                  onClick={() => setPanel("chat")}
                  type="button"
                >
                  Chat
                </button>
              </div>
              <button
                className="rm-panel-close"
                title="Close"
                onClick={() => setPanel(null)}
                type="button"
              >
                <span className="msr">close</span>
              </button>
            </div>

            {panel === "captions" && (
              <div className="rm-captions">
                <div className="rm-captions-label">
                  <span className="rm-captions-dot" />
                  <span>Live transcription</span>
                </div>
                <div className="rm-captions-list" ref={captionsListRef}>
                  {captions.length === 0 && !partial && (
                    <div className="rm-captions-empty">
                      {inCall
                        ? "Captions will appear here as people speak."
                        : "Captions start when the call connects."}
                    </div>
                  )}
                  {captions.map((c, i) => (
                    <div className="rm-caption" key={i}>
                      <div
                        className="rm-caption-name"
                        style={{ color: c.mine ? BLUE : CORAL }}
                      >
                        {c.speaker}
                      </div>
                      <div className="rm-caption-text">{c.text}</div>
                    </div>
                  ))}
                  {partial && (
                    <div className="rm-caption rm-caption--partial">
                      <div className="rm-caption-name" style={{ color: BLUE }}>
                        {partial.speaker}
                      </div>
                      <div className="rm-caption-text">{partial.text}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {panel === "chat" && (
              <div className="rm-chat">
                <div className="rm-chat-list">
                  {messages.map((m, i) => {
                    //Sides by verified sender socket id — like WhatsApp:
                    //own messages right, others left with the name stamped.
                    const mine = m.senderId === socket.id;
                    return (
                      <div className={`rm-msg${mine ? " rm-msg--mine" : ""}`} key={i}>
                        <div className="rm-bubble">
                          {!mine && <div className="rm-bubble-name">{m.who}</div>}
                          {m.text}
                        </div>
                        <div className="rm-msg-meta">{mine ? "You" : m.who}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="rm-composer">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    placeholder="Message"
                  />
                  <button className="rm-send" onClick={send} title="Send" type="button">
                    <span className="msr">send</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rm-controls">
        <button
          className={`rm-circle${micOn ? "" : " rm-circle--danger"}`}
          title="Microphone"
          onClick={toggleMic}
          type="button"
        >
          <span className="msr">{micOn ? "mic" : "mic_off"}</span>
        </button>
        <button
          className={`rm-circle${camOn ? "" : " rm-circle--danger"}`}
          title="Camera"
          onClick={toggleCam}
          type="button"
        >
          <span className="msr">{camOn ? "videocam" : "videocam_off"}</span>
        </button>
        <button
          className={`rm-circle${panel === "captions" ? "" : " rm-circle--idle"}`}
          title="Captions"
          onClick={() => togglePanel("captions")}
          type="button"
        >
          <span className="msr">closed_caption</span>
        </button>
        <button
          className={`rm-circle${panel === "chat" ? "" : " rm-circle--idle"}`}
          title="Chat"
          onClick={() => togglePanel("chat")}
          type="button"
        >
          <span className="msr">chat_bubble</span>
        </button>
        <div className="rm-controls-divider" />
        <button className="rm-leave" title="Leave call" onClick={leave} type="button">
          <span className="msr">call_end</span>
          Leave
        </button>
      </div>

      {call.isReceivingCall && !CallAccepted && (
        <div className="rm-incoming">
          <div className="rm-incoming-card">
            <div className="rm-incoming-name">{call.name || "Someone"} is calling</div>
            <div className="rm-incoming-sub">They used your room code to join.</div>
            <div className="rm-incoming-actions">
              <button className="rm-answer" onClick={AnswerCall} type="button">
                <span className="msr">call</span>
                Answer
              </button>
              <button className="rm-decline" onClick={declineIncoming} type="button">
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

//ContextProvider stays scoped to the room so camera/socket only engage here.
const Room = () => (
  <ContextProvider>
    <RoomInner />
  </ContextProvider>
);

export default Room;
