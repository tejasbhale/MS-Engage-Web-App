/*
 * WebRTC signaling load test for Connect.Two.
 *
 * Spawns N *pairs* of headless Chromium contexts. Each pair forms one call in
 * its own room: a host opens /room/new (its socket id becomes the room code)
 * and auto-answers; a joiner opens /room/<code>, which auto-calls the host.
 * We measure REAL call-setup latency: wall-clock from the joiner's "join"
 * (navigating to the room) until the remote <video> fires `loadeddata` — i.e.
 * offer/answer signaling + peer connection + first remote frame. The
 * loadeddata detection is injected into the page via page.evaluate().
 *
 * It runs a sweep of concurrency levels (default 5,10,25,50 pairs joining
 * simultaneously) and reports p50/p95/p99 latency, join failures/timeouts, and
 * the signaling server process's CPU% / RSS sampled during each level.
 *
 * Requirements (install where you run it):
 *   npm i -D playwright pidusage jsonwebtoken dotenv
 *   npx playwright install chromium
 *
 * Config via env:
 *   BASE_URL     client origin serving the SPA        (default http://localhost:3000)
 *   API_URL      signaling/API origin the socket hits (default http://localhost:5001)
 *   SERVER_PID   pid of the `node index.js` to sample (optional; enables CPU/mem)
 *   LEVELS       comma list of pair counts            (default 5,10,25,50)
 *   JWT_SECRET   read from ../.env if not set          (to mint session cookies)
 *   JOIN_TIMEOUT_MS  per-pair ceiling                  (default 30000)
 *   PAIRS_PER_BROWSER  contexts spread across browsers (default 12)
 */

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const jwt = require("jsonwebtoken");
let pidusage = null;
try {
  pidusage = require("pidusage");
} catch (_) {
  /* CPU/mem sampling optional */
}

const ROOT = path.join(__dirname, "..");
// Load JWT_SECRET from the app's .env if not already in the environment.
if (!process.env.JWT_SECRET) {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^JWT_SECRET=(.+)$/m);
    if (m) process.env.JWT_SECRET = m[1].trim();
  } catch (_) {
    /* fall through */
  }
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const API_URL = process.env.API_URL || "http://localhost:5001";
const SERVER_PID = process.env.SERVER_PID ? Number(process.env.SERVER_PID) : null;
const LEVELS = (process.env.LEVELS || "5,10,25,50").split(",").map((n) => parseInt(n, 10));
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS || 30000);
const PAIRS_PER_BROWSER = Number(process.env.PAIRS_PER_BROWSER || 12);
const SETUP_CONCURRENCY = 10; // unmeasured setup, batched to avoid a thundering herd

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET not found (set env or ../.env). Cannot mint session cookies.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (email, name) =>
  jwt.sign({ email, name, picture: "" }, JWT_SECRET, { expiresIn: "2h" });

// Nearest-rank percentile over a numeric array.
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[idx]);
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// Run async tasks with bounded concurrency.
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const LAUNCH_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

async function newParticipantContext(browser, email, name) {
  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    ignoreHTTPSErrors: true,
  });
  await context.addCookies([
    { name: "session", value: sign(email, name), url: BASE_URL, httpOnly: true },
  ]);
  return context;
}

// The page-side timing hook: resolves when the remote tile's <video> has data.
const REMOTE_READY_HOOK = (timeoutMs) =>
  new Promise((resolve) => {
    const started = performance.now();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve({ ok, ms: Math.round(performance.now() - started) });
    };
    const attach = (v) => {
      if (v.readyState >= 2) return finish(true); // HAVE_CURRENT_DATA
      v.addEventListener("loadeddata", () => finish(true), { once: true });
    };
    const existing = document.querySelector(".rm-remote video");
    if (existing) attach(existing);
    const iv = setInterval(() => {
      const v = document.querySelector(".rm-remote video");
      if (v) {
        clearInterval(iv);
        attach(v);
      }
    }, 30);
    setTimeout(() => {
      clearInterval(iv);
      finish(false);
    }, timeoutMs);
  });

// Auto-answer: the host clicks the incoming-call "Answer" as soon as it appears.
const AUTO_ANSWER_INIT = () => {
  const iv = setInterval(() => {
    const btn = document.querySelector(".rm-answer");
    if (btn) btn.click();
  }, 40);
  setTimeout(() => clearInterval(iv), 90000);
};

// Set up one host: open a room, arm auto-answer, enable camera so the joiner
// receives real frames, and return the room code.
async function setupHost(browser, idx) {
  const context = await newParticipantContext(
    browser,
    `loadtest-host-${idx}@lt.local`,
    `LT Host ${idx}`
  );
  await context.addInitScript(AUTO_ANSWER_INIT);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/room/new`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForFunction(
      () => (document.querySelector("[data-room-code]")?.dataset.roomCode || "") !== "",
      { timeout: 20000 }
    );
    const roomCode = await page.$eval("[data-room-code]", (el) => el.dataset.roomCode);
    // Turn the host camera on so the remote stream carries real video frames.
    await page.click('button[title="Camera"]').catch(() => {});
    return { context, page, roomCode, ok: true };
  } catch (err) {
    return { context, page, ok: false, reason: `host-setup: ${err.message.slice(0, 80)}` };
  }
}

// Pre-create a joiner context+page (navigated to about:blank) so the measured
// phase only times the join → remote-video path, not context creation.
async function setupJoiner(browser, idx) {
  const context = await newParticipantContext(
    browser,
    `loadtest-joiner-${idx}@lt.local`,
    `LT Joiner ${idx}`
  );
  const page = await context.newPage();
  return { context, page };
}

// The measured action: joiner navigates into the room and we time until the
// remote video is ready.
async function joinAndMeasure(pair) {
  if (!pair.host.ok) return { ok: false, reason: pair.host.reason || "host-setup-failed" };
  const t0 = Date.now();
  try {
    await pair.joiner.page.goto(`${BASE_URL}/room/${pair.host.roomCode}`, {
      waitUntil: "domcontentloaded",
      timeout: JOIN_TIMEOUT_MS,
    });
    const res = await pair.joiner.page.evaluate(REMOTE_READY_HOOK, JOIN_TIMEOUT_MS);
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, reason: "timeout-no-remote-video", latencyMs };
    return { ok: true, latencyMs, pageMs: res.ms };
  } catch (err) {
    return { ok: false, reason: `join-error: ${err.message.slice(0, 80)}`, latencyMs: Date.now() - t0 };
  }
}

async function sampleServer(state) {
  if (!SERVER_PID || !pidusage) return;
  while (state.running) {
    try {
      const s = await pidusage(SERVER_PID);
      state.samples.push({ cpu: s.cpu, rss: s.memory });
    } catch (_) {
      /* process may briefly be unsamplable */
    }
    await sleep(400);
  }
}

async function runLevel(pairCount) {
  const nBrowsers = Math.max(1, Math.ceil(pairCount / PAIRS_PER_BROWSER));
  const browsers = [];
  for (let i = 0; i < nBrowsers; i++) {
    browsers.push(await chromium.launch({ headless: true, args: LAUNCH_ARGS }));
  }
  const browserFor = (i) => browsers[i % nBrowsers];

  // --- setup (unmeasured, batched) ---
  const indices = Array.from({ length: pairCount }, (_, i) => i);
  const hosts = await mapLimit(indices, SETUP_CONCURRENCY, (i) => setupHost(browserFor(i), i));
  const joiners = await mapLimit(indices, SETUP_CONCURRENCY, (i) => setupJoiner(browserFor(i), i));
  const pairs = indices.map((i) => ({ host: hosts[i], joiner: joiners[i] }));

  // --- measured: all joiners join simultaneously ---
  const sampler = { running: true, samples: [] };
  const samplerPromise = sampleServer(sampler);
  const results = await Promise.all(pairs.map((p) => joinAndMeasure(p)));
  sampler.running = false;
  await samplerPromise;

  // --- teardown ---
  await Promise.all(browsers.map((b) => b.close().catch(() => {})));

  // --- aggregate ---
  const ok = results.filter((r) => r.ok);
  const latencies = ok.map((r) => r.latencyMs);
  const failures = results.filter((r) => !r.ok);
  const failBreakdown = failures.reduce((acc, f) => {
    const key = (f.reason || "unknown").split(":")[0];
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const cpu = sampler.samples.map((s) => s.cpu);
  const rssMB = sampler.samples.map((s) => s.rss / 1e6);

  return {
    pairs: pairCount,
    connected: ok.length,
    failed: failures.length,
    failBreakdown,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    minMs: latencies.length ? Math.min(...latencies) : null,
    maxMs: latencies.length ? Math.max(...latencies) : null,
    serverCpuAvg: cpu.length ? Math.round(mean(cpu)) : null,
    serverCpuMax: cpu.length ? Math.round(Math.max(...cpu)) : null,
    serverRssMaxMB: rssMB.length ? Math.round(Math.max(...rssMB)) : null,
    samples: sampler.samples.length,
  };
}

(async () => {
  console.log("WebRTC signaling load test");
  console.log(`  client:  ${BASE_URL}`);
  console.log(`  api:     ${API_URL}`);
  console.log(`  server pid for CPU/mem: ${SERVER_PID || "(not sampling)"}`);
  console.log(`  levels:  ${LEVELS.join(", ")} pairs | per-pair timeout ${JOIN_TIMEOUT_MS}ms`);
  console.log("");

  const rows = [];
  for (const level of LEVELS) {
    process.stdout.write(`Level ${level} pairs … `);
    const r = await runLevel(level);
    rows.push(r);
    console.log(
      `connected ${r.connected}/${r.pairs}, ` +
        `p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms, ` +
        `cpu avg/max=${r.serverCpuAvg ?? "-"}/${r.serverCpuMax ?? "-"}%, ` +
        `rss=${r.serverRssMaxMB ?? "-"}MB` +
        (r.failed ? `, FAILURES=${r.failed} ${JSON.stringify(r.failBreakdown)}` : "")
    );
    await sleep(1500); // let the server settle between levels
  }

  console.log("\n==== SUMMARY ====");
  const header = [
    "pairs",
    "connected",
    "failed",
    "p50(ms)",
    "p95(ms)",
    "p99(ms)",
    "min",
    "max",
    "cpu avg%",
    "cpu max%",
    "rss max MB",
  ];
  console.log(header.join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.pairs,
        r.connected,
        r.failed,
        r.p50 ?? "-",
        r.p95 ?? "-",
        r.p99 ?? "-",
        r.minMs ?? "-",
        r.maxMs ?? "-",
        r.serverCpuAvg ?? "-",
        r.serverCpuMax ?? "-",
        r.serverRssMaxMB ?? "-",
      ].join("\t")
    );
  }
  console.log("\nJSON:", JSON.stringify(rows));
  process.exit(0);
})().catch((e) => {
  console.error("LOAD TEST FAILED:", e);
  process.exit(1);
});
