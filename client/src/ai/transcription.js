//Live-transcription boundary. createTranscriber() returns the same interface
//for both engines — { start, stop, addExternalSegment, getFullTranscript } —
//so the call screen never cares which one is running and either can be
//swapped or tested independently.
//
//Engines:
//  "assemblyai" — taps the call's local audio track, streams PCM16 over
//    AssemblyAI's realtime WebSocket using a server-minted ephemeral token
//    (the API key never reaches the browser).
//  "webspeech"  — the browser's native SpeechRecognition; zero-cost fallback.
//
//Selected via REACT_APP_TRANSCRIPTION_MODE; assemblyai auto-falls-back to
//webspeech if the token endpoint is unavailable.

import { apiFetch } from "../api";

export const getTranscriptionMode = () =>
  process.env.REACT_APP_TRANSCRIPTION_MODE === "assemblyai" ? "assemblyai" : "webspeech";

//Shared transcript store: local finals and remote (socket-relayed) lines all
//land here so getFullTranscript() covers the whole meeting in time order.
const createTranscriptStore = () => {
  const segments = [];
  return {
    push(speaker, text) {
      segments.push({ speaker, text, ts: Date.now() });
    },
    getFullTranscript() {
      return segments
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((s) => `${s.speaker}: ${s.text}`)
        .join("\n");
    },
  };
};

//--- AssemblyAI realtime engine -------------------------------------------

const floatTo16BitPCMBase64 = (float32) => {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const createAssemblyAIEngine = ({ stream, speaker, onSegment, onStatus, store }) => {
  let ws = null;
  let audioCtx = null;
  let processor = null;
  let source = null;
  let stopped = false;

  const start = async () => {
    const res = await apiFetch("/ai/assemblyai-token", { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Token request failed (${res.status})`);
    }
    const { token } = await res.json();

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    //Browsers may ignore the requested rate; tell AssemblyAI the actual one.
    const sampleRate = audioCtx.sampleRate;

    await new Promise((resolve, reject) => {
      ws = new WebSocket(
        `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${sampleRate}&token=${token}`
      );
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("Transcription socket failed to open"));
    });

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.message_type === "PartialTranscript" && msg.text) {
        onSegment({ speaker, text: msg.text, isFinal: false });
      } else if (msg.message_type === "FinalTranscript" && msg.text) {
        store.push(speaker, msg.text);
        onSegment({ speaker, text: msg.text, isFinal: true });
      }
    };
    ws.onclose = () => {
      if (!stopped) onStatus("AssemblyAI session closed");
    };

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No local audio track to transcribe");
    source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);
    processor.onaudioprocess = (e) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ audio_data: floatTo16BitPCMBase64(e.inputBuffer.getChannelData(0)) })
        );
      }
    };
    onStatus("assemblyai:live");
  };

  const stop = () => {
    stopped = true;
    if (processor) processor.disconnect();
    if (source) source.disconnect();
    if (audioCtx && audioCtx.state !== "closed") audioCtx.close();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ terminate_session: true }));
      ws.close();
    }
  };

  return { start, stop };
};

//--- Web Speech API engine (zero-cost fallback) ----------------------------

const createWebSpeechEngine = ({ speaker, onSegment, onStatus, store }) => {
  let recognition = null;
  let stopped = false;
  let lastStart = 0;
  let rapidEnds = 0; //guards against a start→fail→restart spin loop

  const start = async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      onStatus("Speech recognition is not supported in this browser");
      return;
    }
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          store.push(speaker, text);
          onSegment({ speaker, text, isFinal: true });
        } else {
          onSegment({ speaker, text, isFinal: false });
        }
      }
    };
    recognition.onerror = (e) => {
      //"no-speech"/"aborted" are routine; onend's auto-restart handles them.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        onStatus(`Speech recognition error: ${e.error}`);
      }
    };
    recognition.onend = () => {
      if (stopped) return;
      //The browser stops recognition after silence; keep it running — but if
      //sessions die instantly (no speech service available), give up rather
      //than spin.
      rapidEnds = Date.now() - lastStart < 1000 ? rapidEnds + 1 : 0;
      if (rapidEnds >= 3) {
        onStatus("Speech recognition unavailable — captions disabled");
        return;
      }
      try {
        lastStart = Date.now();
        recognition.start();
      } catch (err) {
        /* already restarting */
      }
    };

    lastStart = Date.now();
    recognition.start();
    onStatus("webspeech:live");
  };

  const stop = () => {
    stopped = true;
    if (recognition) recognition.stop();
  };

  return { start, stop };
};

//--- Factory ----------------------------------------------------------------

export const createTranscriber = ({ mode, stream, speaker, onSegment, onStatus = () => {} }) => {
  const store = createTranscriptStore();
  const opts = { stream, speaker, onSegment, onStatus, store };

  let engine = mode === "assemblyai" ? createAssemblyAIEngine(opts) : createWebSpeechEngine(opts);

  return {
    async start() {
      try {
        await engine.start();
      } catch (err) {
        if (mode === "assemblyai") {
          //Token endpoint missing / socket refused → free fallback.
          onStatus(`AssemblyAI unavailable (${err.message}) — falling back to browser transcription`);
          engine = createWebSpeechEngine(opts);
          await engine.start();
        } else {
          onStatus(err.message);
        }
      }
    },
    stop() {
      engine.stop();
    },
    //Lines transcribed by the other participant, relayed over the call socket.
    addExternalSegment(speaker, text) {
      store.push(speaker, text);
    },
    getFullTranscript() {
      return store.getFullTranscript();
    },
  };
};
