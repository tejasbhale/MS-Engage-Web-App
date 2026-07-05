//Connect.Two landing page — recreated from design_handoff (Connect.Two.dc.html).
//One hero screen: copy + Google sign-in on the left, an auto-playing demo call
//card (live captions → AI summary crossfade) on the right.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useHistory, Redirect } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";

import { useAuth } from "../AuthContext";
import "./Landing.css";

const CAPTIONS = [
  { name: "Alex", hue: "oklch(0.55 0.13 248)", text: "Are we still targeting the 12th for launch?" },
  { name: "Sam", hue: "oklch(0.58 0.14 40)", text: "Let's push to the 15th — I need Maya's copy first." },
  { name: "Alex", hue: "oklch(0.55 0.13 248)", text: "Works. I'll get pricing in front of legal today." },
  { name: "Sam", hue: "oklch(0.58 0.14 40)", text: "Perfect. Send me the deck when it’s ready." },
];

const ACTION_ITEMS = [
  { text: "Send pricing page to legal", owner: "Alex", pill: "ct-pill--blue" },
  { text: "Get launch copy from Maya", owner: "Sam", pill: "ct-pill--coral" },
  { text: "Share the deck with Sam", owner: "Alex", pill: "ct-pill--blue" },
];

const GoogleGIcon = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

//The hero visual: auto-plays a one-shot demo (typewriter captions, then a
//crossfade to the summary) and rests there. "replay" restarts it.
const DemoCallCard = () => {
  const [phase, setPhase] = useState("live"); //'live' | 'summary'
  const [shown, setShown] = useState(0); //caption lines fully revealed
  const [chars, setChars] = useState(0); //chars revealed of the typing line
  const [seconds, setSeconds] = useState(0);

  //All pending timers, so replay/unmount can wipe the sequence cleanly.
  const timers = useRef([]);
  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    timers.current = [];
  }, []);

  const typeLine = useCallback((i) => {
    if (i >= CAPTIONS.length) {
      //Call ends 1100ms after the last line; timer freezes on the summary.
      timers.current.push(setTimeout(() => setPhase("summary"), 1100));
      return;
    }
    setShown(i);
    setChars(0);
    const text = CAPTIONS[i].text;
    let c = 0;
    const iv = setInterval(() => {
      c += 1;
      setChars(c);
      if (c >= text.length) {
        clearInterval(iv);
        timers.current.push(setTimeout(() => typeLine(i + 1), 650));
      }
    }, 34);
    timers.current.push(iv);
  }, []);

  const run = useCallback(() => {
    clearTimers();
    setPhase("live");
    setShown(0);
    setChars(0);
    setSeconds(0);

    //Reduced motion: skip the animation and land on the payoff immediately.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("summary");
      return;
    }

    timers.current.push(
      setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000)
    );
    timers.current.push(setTimeout(() => typeLine(0), 500));
  }, [clearTimers, typeLine]);

  useEffect(() => {
    run();
    return clearTimers;
  }, [run, clearTimers]);

  const isLive = phase === "live";
  const doneLines = CAPTIONS.slice(0, shown);
  const curCap = isLive && shown < CAPTIONS.length ? CAPTIONS[shown] : null;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const metaStr = isLive ? `${mm}:${ss}` : "3:04 · ended";

  return (
    <div className="ct-visual-inner">
      <div className="ct-card">
        <div className="ct-card-head">
          <div className="ct-card-people">
            <div className="ct-avatars">
              <div className="ct-avatar ct-avatar--blue">A</div>
              <div className="ct-avatar ct-avatar--coral">S</div>
            </div>
            <span className="ct-card-names">Alex &amp; Sam</span>
          </div>
          <div className="ct-card-status">
            <div className={`ct-dot${isLive ? " ct-dot--live" : ""}`} />
            <span className="ct-card-time">{metaStr}</span>
          </div>
        </div>

        <div className="ct-card-body">
          <div className={`ct-layer${isLive ? "" : " ct-layer--hidden-up"}`}>
            <div className="ct-captions">
              {doneLines.map((line, idx) => (
                <div className="ct-caption" key={idx}>
                  <span className="ct-caption-name" style={{ color: line.hue }}>
                    {line.name}
                    {"  "}
                  </span>
                  <span className="ct-caption-text">{line.text}</span>
                </div>
              ))}
              {curCap && (
                <div className="ct-caption ct-caption--current">
                  <span className="ct-caption-name" style={{ color: curCap.hue }}>
                    {curCap.name}
                    {"  "}
                  </span>
                  <span className="ct-caption-text">{curCap.text.slice(0, chars)}</span>
                  <span className="ct-caret" />
                </div>
              )}
            </div>
            <div className="ct-captions-foot">
              <span>Live captions on</span>
            </div>
          </div>

          <div className={`ct-layer${isLive ? " ct-layer--hidden-down" : ""}`}>
            <div className="ct-summary">
              <div className="ct-summary-head">
                <span className="ct-summary-title">Summary</span>
                <span className="ct-summary-meta">delivered &middot; just now</span>
              </div>
              <p className="ct-summary-recap">
                Launch moves to the 15th, pending Maya&rsquo;s copy and a legal review of pricing.
              </p>
              <div className="ct-summary-label">Action items</div>
              <div className="ct-actions">
                {ACTION_ITEMS.map((item) => (
                  <div className="ct-action" key={item.text}>
                    <div className="ct-checkbox" />
                    <span className="ct-action-text">{item.text}</span>
                    <span className={`ct-pill ${item.pill}`}>{item.owner}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ct-replay-row">
        <button className="ct-replay" onClick={run} type="button">
          &#8635; replay
        </button>
      </div>
    </div>
  );
};

const Landing = () => {
  const history = useHistory();
  const { loginWithGoogle, isAuthenticated, loading } = useAuth();

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      await loginWithGoogle(credentialResponse.credential);
      history.push("/home");
    } catch (err) {
      console.error(err);
      alert("Sign-in failed. Please try again.");
    }
  };

  //An already-signed-in user landing on "/" (e.g. by editing the URL) belongs
  //in the app, not on the marketing/sign-in page — send them home. Render
  //nothing until the session check resolves so the sign-in page never flashes.
  if (loading) return null;
  if (isAuthenticated) return <Redirect to="/home" />;

  return (
    <div className="ct-page">
      <header className="ct-header">
        <div className="ct-wordmark">
          <div className="ct-mark">
            <div className="ct-mark-dot ct-mark-dot--blue" />
            <div className="ct-mark-dot ct-mark-dot--coral" />
          </div>
          <span className="ct-wordmark-text">
            Connect<span>.Two</span>
          </span>
        </div>
        <span className="ct-header-tag">Peer&#8209;to&#8209;peer &middot; no downloads</span>
      </header>

      <main className="ct-main">
        <div className="ct-copy">
          <h1 className="ct-h1">You talk. It keeps the record.</h1>
          <p className="ct-sub">
            A peer&#8209;to&#8209;peer video call with live captions while you speak &mdash; and a
            clean summary with action items the moment you hang up.
          </p>
          <div className="ct-cta-row">
            <div className="ct-cta-wrap">
              <button className="ct-cta" type="button" tabIndex={-1} aria-hidden="true">
                <span className="ct-cta-gicon">
                  <GoogleGIcon />
                </span>
                Sign in with Google
              </button>
              {/* Real Google button, invisible on top: Google's iframe button
                  can't be restyled, so the styled button below provides the
                  visuals while this captures the actual clicks. */}
              <div className="ct-cta-overlay">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => alert("Google sign-in failed. Please try again.")}
                  type="standard"
                  size="large"
                  width="230"
                />
              </div>
            </div>
            <span className="ct-cta-note">
              No note&#8209;taking.
              <br />
              Nothing to configure.
            </span>
          </div>
        </div>

        <div className="ct-visual">
          <DemoCallCard />
        </div>
      </main>

      <footer className="ct-footer">
        <div className="ct-footer-inner">
          <span>Open a call</span>
          <span className="ct-footer-dot" />
          <span>Talk normally</span>
          <span className="ct-footer-dot" />
          <span>Your summary&rsquo;s waiting the second you hang up</span>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
