# Connect.Two — Peer-to-Peer Video Platform

A rebuilt peer-to-peer video communication app: Google-authenticated 1:1 video
calls with live transcription, an AI summarization pipeline that extracts
structured action items, and a persistent, live-updating meeting history.

> Rebuilt from the original *Microsoft Engage 2021* video-chat submission —
> re-architected around SOLID boundaries with authentication, real-time AI, and
> persistence added.

## Features

- **1:1 WebRTC video** over a Socket.IO signaling layer (`simple-peer`,
  single offer/answer exchange).
- **Google OAuth 2.0** sign-in; sessions carried in an httpOnly JWT cookie
  (1-day TTL, auto-logout on expiry).
- **Live transcription** — AssemblyAI realtime (via server-minted ephemeral
  tokens) with a browser-native Web Speech fallback. Transcription is gated on
  mic state, so muting stops capture.
- **AI meeting summaries** — a LangChain + Gemini (`gemini-2.5-flash`) pipeline
  produces a summary plus structured, typed action items. Falls back to a
  keyless heuristic summarizer when no key / quota is available, and says so.
- **Persistent history** — calls, transcripts, summaries, and action items are
  stored in MongoDB. A recent-meetings drawer streams **Change-Stream-driven
  live updates** to the owning user only.
- **Editable summaries & action items** — debounced + on-blur autosave, add
  action items manually with owner/due-date.
- **Security hardening** — JWT-authenticated sockets, IDOR guards on call
  routes, `helmet`, rate limiting, and explicit CORS origins with credentials.

## Architecture

The server is split along SOLID boundaries rather than one monolithic file:

| Path | Responsibility |
|------|----------------|
| `index.js` | App composition / bootstrap |
| `config.js` | Environment + config loading |
| `db.js` | Mongoose connection, `User` and `Call` schemas |
| `middleware/auth.js` | JWT cookie verification |
| `routes/auth.js` | Google OAuth exchange, session issue/clear |
| `routes/calls.js` | Call history, summary/action-item CRUD (IDOR-guarded) |
| `routes/ai.js` | Ephemeral transcription tokens, summarization endpoint |
| `socket/signaling.js` | WebRTC signaling, identity, end-and-summarize |
| `summarize.js` | LangChain + Gemini summary / action-item extraction |
| `client/` | React (CRA) front end |
| `loadtest/` | Playwright end-to-end + raw-socket signaling load tests |

## Getting started

### Prerequisites
- Node.js 18+
- A MongoDB connection string (Atlas M0 works; Change Streams require a replica
  set, which Atlas provides). Optional — leave empty for signaling-only.
- A Google OAuth 2.0 Web client ID.
- Optional: AssemblyAI key (realtime transcription) and Google AI Studio key
  (Gemini summaries).

### Configure
Copy the example env files and fill in your own values (both are gitignored):

```bash
cp .env.example .env
cp client/.env.example client/.env
```

Generate a JWT secret with `openssl rand -hex 32`.

### Install & run

```bash
# server (from repo root)
npm install
npm start            # http://localhost:5001

# client (in another terminal)
cd client
npm install
npm start            # http://localhost:3000
```

## Load testing

Two harnesses live in `loadtest/`:

- `signaling-loadtest.js` — Playwright-driven concurrent browser pairs that
  measure real end-to-end call setup (media included).
- `signaling-raw-loadtest.js` — raw `socket.io-client` pairs that isolate the
  signaling server's true ceiling, without the browser/WebRTC bottleneck.

The raw-socket harness sustained **1,000 concurrent call-setup handshakes at
35 ms p95** (100% success, single Node process at ~70% CPU), scaling to ~2,000
before the single thread saturated. This measures signaling handshake latency
(offer → server relay → answer → server relay), not full ICE/media.

## Security notes

Secrets live only in `.env` / `client/.env`, which are gitignored. Never commit
real keys — use the `.env.example` templates as the checked-in reference.
