/*
 * RAW-SOCKET signaling load test for Connect.Two.
 *
 * Unlike the Playwright test (which spins up real browsers + RTCPeerConnections
 * and is bottlenecked by the client machine well before the server), this drives
 * the signaling handshake directly with lightweight socket.io-client connections
 * and NO browser / real WebRTC media. That removes the load generator as the
 * bottleneck so the *signaling server's* true ceiling is what we measure.
 *
 * Per pair, it reproduces exactly the app's signaling exchange:
 *   joiner  --CallUser(offer)-->  server  --CallUser-->  host
 *   host    --AnswerCall(answer)-> server  --CallAccepted-> joiner
 * We time each pair from the joiner emitting CallUser to it receiving
 * CallAccepted — i.e. the server-relayed signaling round trip ("call setup"),
 * carrying representative ~2KB SDP payloads. This is a *signaling* latency, not
 * full ICE/media connectivity (that's what the browser test covers).
 *
 * Sweeps increasing pair counts and reports p50/p95/p99, failures/timeouts, and
 * BOTH the server process and this generator process CPU/RSS — so you can tell
 * whether the server or the generator saturated first.
 *
 * Requirements: npm i socket.io-client jsonwebtoken pidusage
 * Config via env: API_URL, ORIGIN, SERVER_PID, LEVELS, HANDSHAKE_TIMEOUT_MS,
 *                 SDP_BYTES, JWT_SECRET (or read from ../.env).
 * Run with a raised FD limit on both ends: `ulimit -n 20000`.
 */

const path = require("path");
const fs = require("fs");
const { performance } = require("perf_hooks");
const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");
let pidusage = null;
try {
  pidusage = require("pidusage");
} catch (_) {
  /* optional */
}

const ROOT = path.join(__dirname, "..");
if (!process.env.JWT_SECRET) {
  try {
    const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^JWT_SECRET=(.+)$/m);
    if (m) process.env.JWT_SECRET = m[1].trim();
  } catch (_) {
    /* ignore */
  }
}
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET not found (env or ../.env).");
  process.exit(1);
}

const API_URL = process.env.API_URL || "http://localhost:5602";
const ORIGIN = process.env.ORIGIN || "http://localhost:3100";
const SERVER_PID = process.env.SERVER_PID ? Number(process.env.SERVER_PID) : null;
const LEVELS = (process.env.LEVELS || "50,100,250,500,1000").split(",").map((n) => parseInt(n, 10));
const HANDSHAKE_TIMEOUT_MS = Number(process.env.HANDSHAKE_TIMEOUT_MS || 15000);
const SDP_BYTES = Number(process.env.SDP_BYTES || 2000);
const CONNECT_BATCH = Number(process.env.CONNECT_BATCH || 100);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (email, name) => jwt.sign({ email, name, picture: "" }, JWT_SECRET, { expiresIn: "2h" });

// A representative SDP-ish payload so relay cost reflects real offers/answers.
const SDP = (() => {
  let s =
    "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" +
    "a=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 103 104\r\n";
  while (s.length < SDP_BYTES) {
    s += `a=candidate:${s.length} 1 udp 2122260223 192.168.1.${s.length % 255} 50000 typ host generation 0\r\n`;
  }
  return s.slice(0, SDP_BYTES);
})();

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]);
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function connect(email, name) {
  const socket = io(API_URL, {
    transports: ["websocket"],
    extraHeaders: { Cookie: `session=${sign(email, name)}`, Origin: ORIGIN },
    reconnection: false,
    forceNew: true,
    timeout: 10000,
  });
  const ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("connect-timeout")), 12000);
    socket.on("me", (id) => {
      clearTimeout(to);
      resolve(id);
    });
    socket.on("connect_error", (e) => {
      clearTimeout(to);
      reject(new Error(`connect_error: ${e.message}`));
    });
  });
  return { socket, ready };
}

async function sampleProc(pid, state) {
  if (!pid || !pidusage) return;
  while (state.running) {
    try {
      const s = await pidusage(pid);
      state.samples.push({ cpu: s.cpu, rss: s.memory });
    } catch (_) {
      /* ignore */
    }
    await sleep(300);
  }
}

async function runLevel(pairCount) {
  const hosts = [];
  const joiners = [];
  let setupFail = 0;

  // --- setup: connect all sockets in batches, capture socket ids ---
  for (let start = 0; start < pairCount; start += CONNECT_BATCH) {
    const batch = [];
    for (let i = start; i < Math.min(start + CONNECT_BATCH, pairCount); i++) {
      const h = connect(`rlt-host-${i}@lt.local`, `RLT Host ${i}`);
      const j = connect(`rlt-join-${i}@lt.local`, `RLT Join ${i}`);
      batch.push(
        Promise.all([h.ready, j.ready])
          .then(([hostId, joinerId]) => {
            // Host answers the instant the relayed CallUser arrives.
            h.socket.on("CallUser", ({ from }) => {
              h.socket.emit("AnswerCall", { signal: SDP, to: from });
            });
            hosts[i] = { ...h, id: hostId };
            joiners[i] = { ...j, id: joinerId };
          })
          .catch(() => {
            setupFail++;
            try {
              h.socket.close();
              j.socket.close();
            } catch (_) {
              /* ignore */
            }
          })
      );
    }
    await Promise.all(batch);
  }

  // --- measured: every joiner fires CallUser at once, awaits CallAccepted ---
  const server = { running: true, samples: [] };
  const client = { running: true, samples: [] };
  const sp = sampleProc(SERVER_PID, server);
  const cp = sampleProc(process.pid, client);

  const measure = (i) =>
    new Promise((resolve) => {
      const host = hosts[i];
      const joiner = joiners[i];
      if (!host || !joiner) return resolve({ ok: false, reason: "setup-failed" });
      const t0 = performance.now();
      const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), HANDSHAKE_TIMEOUT_MS);
      joiner.socket.once("CallAccepted", () => {
        clearTimeout(timer);
        resolve({ ok: true, latencyMs: performance.now() - t0 });
      });
      joiner.socket.emit("CallUser", { userToCall: host.id, signalData: SDP, from: joiner.id });
    });

  const results = await Promise.all(
    Array.from({ length: pairCount }, (_, i) => measure(i))
  );

  server.running = false;
  client.running = false;
  await Promise.all([sp, cp]);

  // --- teardown ---
  for (let i = 0; i < pairCount; i++) {
    try {
      hosts[i] && hosts[i].socket.close();
      joiners[i] && joiners[i].socket.close();
    } catch (_) {
      /* ignore */
    }
  }
  await sleep(500); // let the server release the sockets before the next level

  const ok = results.filter((r) => r.ok);
  const lat = ok.map((r) => r.latencyMs);
  const fails = results.filter((r) => !r.ok);
  const breakdown = fails.reduce((a, f) => ((a[f.reason] = (a[f.reason] || 0) + 1), a), {});
  const scpu = server.samples.map((s) => s.cpu);
  const ccpu = client.samples.map((s) => s.cpu);
  return {
    pairs: pairCount,
    connected: ok.length,
    failed: fails.length,
    setupFail,
    breakdown,
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    maxMs: lat.length ? Math.round(Math.max(...lat)) : null,
    serverCpuMax: scpu.length ? Math.round(Math.max(...scpu)) : null,
    serverRssMB: server.samples.length ? Math.round(Math.max(...server.samples.map((s) => s.rss)) / 1e6) : null,
    genCpuMax: ccpu.length ? Math.round(Math.max(...ccpu)) : null,
  };
}

(async () => {
  console.log("RAW-SOCKET signaling load test");
  console.log(`  api: ${API_URL} | server pid: ${SERVER_PID || "(no cpu sampling)"}`);
  console.log(`  levels: ${LEVELS.join(", ")} pairs | SDP payload ${SDP.length}B | timeout ${HANDSHAKE_TIMEOUT_MS}ms\n`);

  const rows = [];
  for (const level of LEVELS) {
    process.stdout.write(`Level ${level} pairs … `);
    const r = await runLevel(level);
    rows.push(r);
    console.log(
      `connected ${r.connected}/${r.pairs} (setupFail ${r.setupFail}), ` +
        `p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms max=${r.maxMs}ms, ` +
        `SERVER cpu max=${r.serverCpuMax ?? "-"}% rss=${r.serverRssMB ?? "-"}MB, ` +
        `gen cpu max=${r.genCpuMax ?? "-"}%` +
        (r.failed ? `, FAIL=${r.failed} ${JSON.stringify(r.breakdown)}` : "")
    );
    await sleep(1500);
  }

  console.log("\n==== SUMMARY (signaling handshake latency) ====");
  console.log(["pairs", "ok", "fail", "p50", "p95", "p99", "max", "srvCPU%", "srvRSS_MB", "genCPU%"].join("\t"));
  for (const r of rows) {
    console.log(
      [r.pairs, r.connected, r.failed, r.p50 ?? "-", r.p95 ?? "-", r.p99 ?? "-", r.maxMs ?? "-", r.serverCpuMax ?? "-", r.serverRssMB ?? "-", r.genCpuMax ?? "-"].join("\t")
    );
  }
  console.log("\nJSON:", JSON.stringify(rows));
  process.exit(0);
})().catch((e) => {
  console.error("RAW LOAD TEST FAILED:", e);
  process.exit(1);
});
