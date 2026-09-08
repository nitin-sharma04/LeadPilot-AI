"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VOICE_LAB_EXPERIMENTS,
  VOICE_LAB_SCENARIOS,
  VOICE_LAB_TEST_LINES,
  VOICE_LAB_TTS_SPEEDS,
  VOICE_LAB_VAD_PRESETS,
} from "../../../voice-lab/scenarios";
import {
  VOICE_LAB_LATENCY_PRESETS,
  type VoiceLabLatencyPresetId,
} from "../../../voice-lab/config";
import {
  VOICE_LAB_PROMPT_LABELS,
  VOICE_LAB_PROMPT_VARIANTS,
  type VoiceLabPromptVariant,
} from "../../../voice-lab/lab-prompt";
import type {
  VoiceLabAppointmentStatus,
  VoiceLabScenarioId,
  VoiceLabSessionJson,
  VoiceLabStructuredLog,
  VoiceLabTimelineEvent,
  VoiceLabTranscriptRow,
  VoiceLabTurnState,
} from "../../../voice-lab/types";

const REPORT_CATEGORIES: Array<{
  key: keyof VoiceLabSessionJson["score"]["breakdown"];
  label: string;
}> = [
  { key: "listeningAccuracy", label: "Listening" },
  { key: "turnTaking", label: "Turn taking" },
  { key: "responseSpeed", label: "Response speed" },
  { key: "speechPace", label: "Speech pace" },
  { key: "naturalness", label: "Naturalness" },
  { key: "repetition", label: "Repetition" },
  { key: "interruptionHandling", label: "Interruption handling" },
  { key: "responseRelevance", label: "Response relevance" },
  { key: "conversationMemory", label: "Conversation memory" },
  { key: "appointmentHandling", label: "Appointment handling" },
  { key: "endingBehavior", label: "Ending" },
  { key: "duplicateResponseSafety", label: "Duplicate safety" },
];

/** Mic energy heuristics (browser side only; Gemini VAD is authoritative for turn end). */
const MIC_START_RMS = 0.02;
/** Speaker bleed is much quieter than live speech; require a loud, sustained signal to barge-in. */
const MIC_START_RMS_WHILE_AI_SPEAKING = 0.08;
const MIC_STOP_RMS = 0.012;
const MIC_START_FRAMES = 3; // ≈130 ms at 2048 samples / 48 kHz
const MIC_START_FRAMES_WHILE_AI = 8; // ≈340 ms — don't cut the AI on a cough or echo spike
const MIC_STOP_MS = 350;

type Conn = {
  microphone: boolean;
  websocket: boolean;
  gemini: boolean;
  deepgram: boolean;
  playback: boolean;
};

type AudioStats = {
  framesReceived: number;
  lastFrameAgoMs: number | null;
  forwardingToGemini: boolean;
};

type ExperimentSnap = {
  id: string;
  vadSilenceMs: number;
  ttsSpeed: number;
  overall?: number;
  interruptions?: number;
  wpm?: number | null;
  promptVariant?: VoiceLabPromptVariant;
};

type AbResult = {
  promptVariant: VoiceLabPromptVariant;
  overall: number;
  medianStartMs: number | null;
  avgWords: number | null;
  interruptions: number;
  earlyCutoffs: number;
  repeats: number;
  missed: number;
  at: string;
};

type LatencyView = {
  userFinishedToAudioMs?: number | null;
  micEndToAudioMs?: number | null;
  geminiMs?: number | null;
  ttsMs?: number | null;
  firstByteMs?: number | null;
};

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function resampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  const target = 16000;
  if (!input.length) return new Int16Array(0);
  const ratio = inputRate / target;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = src - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    const s = Math.max(-1, Math.min(1, sample));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function rms(samples: Float32Array): number {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / Math.max(1, samples.length));
}

export function VoiceLabClient({ wsUrl }: { wsUrl: string }) {
  const [scenarioId, setScenarioId] = useState<VoiceLabScenarioId>("general_sdr");
  const [promptVariant, setPromptVariant] = useState<VoiceLabPromptVariant>("lab");
  const [activePrompt, setActivePrompt] = useState<VoiceLabPromptVariant | null>(null);
  const [abResults, setAbResults] = useState<AbResult[]>([]);
  const [vadSilenceMs, setVadSilenceMs] = useState(900);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [latencyPreset, setLatencyPreset] = useState<VoiceLabLatencyPresetId>("normal");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnState, setTurnState] = useState<VoiceLabTurnState>("idle");
  const [epoch, setEpoch] = useState(0);
  const [conn, setConn] = useState<Conn>({
    microphone: false,
    websocket: false,
    gemini: false,
    deepgram: false,
    playback: false,
  });
  const [audioStats, setAudioStats] = useState<AudioStats | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [liveAi, setLiveAi] = useState("");
  const [liveUser, setLiveUser] = useState("");
  const [rows, setRows] = useState<VoiceLabTranscriptRow[]>([]);
  const [timeline, setTimeline] = useState<VoiceLabTimelineEvent[]>([]);
  const [logs, setLogs] = useState<VoiceLabStructuredLog[]>([]);
  const [appointment, setAppointment] = useState<VoiceLabAppointmentStatus>("none");
  const [latency, setLatency] = useState<LatencyView>({});
  const [wordCount, setWordCount] = useState<number | null>(null);
  const [wpm, setWpm] = useState<number | null>(null);
  const [interruptions, setInterruptions] = useState(0);
  const [staleDropped, setStaleDropped] = useState(0);
  const [report, setReport] = useState<VoiceLabSessionJson | null>(null);
  const [experiments, setExperiments] = useState<ExperimentSnap[]>(
    VOICE_LAB_EXPERIMENTS.map((e) => ({ ...e }))
  );

  const wsRef = useRef<WebSocket | null>(null);
  const startingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playTimeRef = useRef(0);
  const playingRef = useRef(false);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const epochRef = useRef(0);
  const speakMsRef = useRef(0);
  const wordsRef = useRef(0);
  const micSpeakingRef = useRef(false);
  const micAboveFramesRef = useRef(0);
  const micBelowSinceRef = useRef<number | null>(null);
  const lastLevelPaintRef = useRef(0);

  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
    }
    sourcesRef.current = [];
    playTimeRef.current = ctxRef.current?.currentTime ?? 0;
  }, []);

  const enqueuePlayback = useCallback((pcm16k: Int16Array, audioEpoch: number) => {
    const ctx = ctxRef.current;
    if (!ctx || !pcm16k.length) return;
    if (audioEpoch < epochRef.current) {
      setStaleDropped((n) => n + 1);
      return;
    }
    if (audioEpoch > epochRef.current) {
      epochRef.current = audioEpoch;
      setEpoch(audioEpoch);
    }
    playingRef.current = true;
    const buffer = ctx.createBuffer(1, pcm16k.length, 16000);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm16k.length; i++) data[i] = pcm16k[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playTimeRef.current);
    src.start(startAt);
    playTimeRef.current = startAt + buffer.duration;
    sourcesRef.current.push(src);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      if (!sourcesRef.current.length) playingRef.current = false;
    };
  }, []);

  const cleanupMedia = useCallback(() => {
    stopPlayback();
    try {
      processorRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    micSpeakingRef.current = false;
    setUserSpeaking(false);
    setMicLevel(0);
    setConn((c) => ({ ...c, microphone: false, playback: false }));
  }, [stopPlayback]);

  const endConversation = useCallback(() => {
    try {
      wsRef.current?.send(JSON.stringify({ type: "stop" }));
    } catch {
      /* ignore */
    }
    const ws = wsRef.current;
    wsRef.current = null;
    // Give the server a moment to deliver the report before closing.
    setTimeout(() => ws?.close(), 800);
    cleanupMedia();
    setRunning(false);
    setTurnState("ended");
  }, [cleanupMedia]);

  const startConversation = useCallback(async () => {
    // Idempotent: double-click, re-render, StrictMode — only one session may exist.
    if (startingRef.current || wsRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    setWarning(null);
    setReport(null);
    setRows([]);
    setTimeline([]);
    setLogs([]);
    setLiveAi("");
    setLiveUser("");
    setInterruptions(0);
    setStaleDropped(0);
    setAppointment("none");
    setLatency({});
    setWordCount(null);
    setSessionId(null);
    speakMsRef.current = 0;
    wordsRef.current = 0;
    epochRef.current = 0;
    setEpoch(0);
    setWpm(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      setError("Microphone permission denied");
      startingRef.current = false;
      setStarting(false);
      return;
    }
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    await ctx.resume();
    playTimeRef.current = ctx.currentTime;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    setConn({ microphone: true, websocket: false, gemini: false, deepgram: false, playback: true });

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConn((c) => ({ ...c, websocket: true }));
      ws.send(
        JSON.stringify({
          type: "start",
          scenarioId,
          promptVariant,
          vadSilenceMs,
          ttsSpeed,
          latencyPreset,
        })
      );
      setRunning(true);
      setStarting(false);
      startingRef.current = false;
      setTurnState("listening");
    };
    ws.onerror = () => {
      setError("WebSocket failed — is voice-server running on 8081?");
      startingRef.current = false;
      setStarting(false);
    };
    ws.onclose = () => {
      setConn((c) => ({ ...c, websocket: false, gemini: false }));
      if (wsRef.current === ws) {
        wsRef.current = null;
        cleanupMedia();
        setRunning(false);
      }
      startingRef.current = false;
      setStarting(false);
    };
    ws.onmessage = (ev) => {
      if (wsRef.current !== ws && ws.readyState !== WebSocket.OPEN) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case "ready":
          if (typeof msg.promptVariant === "string") {
            setActivePrompt(msg.promptVariant as VoiceLabPromptVariant);
          }
          if (typeof msg.sessionId === "string") setSessionId(msg.sessionId);
          break;
        case "connections":
          setConn((c) => ({
            ...c,
            websocket: Boolean(msg.websocket ?? c.websocket),
            gemini: Boolean(msg.gemini),
            deepgram: Boolean(msg.deepgram),
            playback: true,
            microphone: true,
          }));
          break;
        case "audio-stats":
          setAudioStats({
            framesReceived: Number(msg.framesReceived ?? 0),
            lastFrameAgoMs: (msg.lastFrameAgoMs as number | null) ?? null,
            forwardingToGemini: Boolean(msg.forwardingToGemini),
          });
          break;
        case "state":
          setTurnState(msg.turnState as VoiceLabTurnState);
          if (typeof msg.epoch === "number" && msg.epoch > epochRef.current) {
            epochRef.current = msg.epoch;
            setEpoch(msg.epoch);
          }
          break;
        case "error":
          setError(`${msg.source}: ${msg.message}`);
          break;
        case "warning":
          setWarning(String(msg.message));
          break;
        case "timeline":
          if (msg.event) setTimeline((t) => [...t, msg.event as VoiceLabTimelineEvent]);
          break;
        case "log":
          if (msg.log) {
            setLogs((l) => {
              const next = [...l, msg.log as VoiceLabStructuredLog];
              return next.length > 300 ? next.slice(next.length - 300) : next;
            });
          }
          break;
        case "transcript": {
          const row = msg.row as VoiceLabTranscriptRow;
          if (row.kind === "AI_GENERATING") {
            setLiveAi(row.text);
            break;
          }
          if (row.kind === "USER_PARTIAL") {
            setLiveUser(row.text);
            break;
          }
          setRows((r) => [...r, row]);
          if (row.kind === "USER_FINAL") setLiveUser("");
          if (row.kind === "AI_GENERATED") {
            setLiveAi("");
            wordsRef.current += row.text.split(/\s+/).filter(Boolean).length;
          }
          break;
        }
        case "audio": {
          if (typeof msg.pcm16kBase64 !== "string") break;
          const audioEpoch = typeof msg.epoch === "number" ? msg.epoch : epochRef.current;
          const pcm = base64ToInt16(msg.pcm16kBase64);
          if (audioEpoch >= epochRef.current) {
            speakMsRef.current += (pcm.length / 16000) * 1000;
            if (wordsRef.current > 0 && speakMsRef.current > 200) {
              setWpm(Math.round((wordsRef.current / speakMsRef.current) * 60000));
            }
          }
          enqueuePlayback(pcm, audioEpoch);
          break;
        }
        case "clear-audio":
        case "bargein":
          if (typeof msg.epoch === "number" && msg.epoch > epochRef.current) {
            epochRef.current = msg.epoch;
            setEpoch(msg.epoch);
          }
          stopPlayback();
          if (typeof msg.count === "number") setInterruptions(msg.count);
          break;
        case "appointment":
          setAppointment(msg.status as VoiceLabAppointmentStatus);
          break;
        case "latency":
          setLatency({
            userFinishedToAudioMs: (msg.userFinishedToAudioMs as number) ?? null,
            micEndToAudioMs: (msg.micEndToAudioMs as number) ?? null,
            geminiMs: (msg.geminiMs as number) ?? null,
            ttsMs: (msg.ttsMs as number) ?? null,
            firstByteMs: (msg.firstByteMs as number) ?? null,
          });
          break;
        case "metrics":
          if (typeof msg.wordCount === "number") setWordCount(msg.wordCount);
          break;
        case "ended": {
          if (!msg.report) break;
          const payload = msg.report as VoiceLabSessionJson;
          setReport(payload);
          const starts = payload.turns
            .map((t) => t.transcriptToFirstAudioMs)
            .filter((n): n is number => n !== null);
          const counts = payload.speech.responseWordCounts;
          setAbResults((prev) =>
            [
              {
                promptVariant: payload.promptVariant,
                overall: payload.score.overall,
                medianStartMs: medianOf(starts),
                avgWords: counts.length
                  ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)
                  : null,
                interruptions: payload.interruptions,
                earlyCutoffs: payload.earlyCutoffs,
                repeats:
                  payload.repetition.repeatedSentences + payload.repetition.repeatedAcknowledgements,
                missed: payload.counters?.missedResponses ?? 0,
                at: payload.timestamp,
              },
              ...prev,
            ].slice(0, 8)
          );
          void fetch("/api/voice-lab/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          setExperiments((prev) => {
            const hit = prev.find(
              (e) => e.vadSilenceMs === vadSilenceMs && Math.abs(e.ttsSpeed - ttsSpeed) < 0.02
            );
            if (!hit) return prev;
            return prev.map((e) =>
              e.id === hit.id
                ? {
                    ...e,
                    overall: payload.score.overall,
                    interruptions: payload.interruptions,
                    wpm: payload.speech.estimatedWpm,
                    promptVariant: payload.promptVariant,
                  }
                : e
            );
          });
          cleanupMedia();
          setRunning(false);
          setTurnState("ended");
          break;
        }
        default:
          break;
      }
    };

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const level = rms(input);
      const now = performance.now();
      if (now - lastLevelPaintRef.current > 80) {
        lastLevelPaintRef.current = now;
        setMicLevel(level);
      }

      // Speaking detection with hysteresis. Higher threshold while AI audio is playing so
      // speaker bleed does not trigger false barge-ins (AEC is on, but be conservative).
      const startThreshold = playingRef.current ? MIC_START_RMS_WHILE_AI_SPEAKING : MIC_START_RMS;
      const startFrames = playingRef.current ? MIC_START_FRAMES_WHILE_AI : MIC_START_FRAMES;
      if (!micSpeakingRef.current) {
        if (level > startThreshold) {
          micAboveFramesRef.current += 1;
          if (micAboveFramesRef.current >= startFrames) {
            micSpeakingRef.current = true;
            micBelowSinceRef.current = null;
            setUserSpeaking(true);
            if (playingRef.current) stopPlayback(); // barge-in: cut audio locally right away
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "mic", speaking: true, level }));
            }
          }
        } else {
          micAboveFramesRef.current = 0;
        }
      } else if (level < MIC_STOP_RMS) {
        if (micBelowSinceRef.current === null) micBelowSinceRef.current = now;
        else if (now - micBelowSinceRef.current >= MIC_STOP_MS) {
          micSpeakingRef.current = false;
          micAboveFramesRef.current = 0;
          micBelowSinceRef.current = null;
          setUserSpeaking(false);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "mic", speaking: false, level }));
          }
        }
      } else {
        micBelowSinceRef.current = null;
      }

      // Continuous streaming: every frame goes to the server for the whole session.
      if (ws.readyState !== WebSocket.OPEN) return;
      const pcm = resampleTo16k(input, ctx.sampleRate);
      if (!pcm.length) return;
      ws.send(JSON.stringify({ type: "audio", pcm16kBase64: pcm16ToBase64(pcm) }));
    };
  }, [
    cleanupMedia,
    enqueuePlayback,
    promptVariant,
    scenarioId,
    stopPlayback,
    ttsSpeed,
    vadSilenceMs,
    latencyPreset,
    wsUrl,
  ]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const audioReceiving =
    running && audioStats !== null && audioStats.lastFrameAgoMs !== null && audioStats.lastFrameAgoMs < 1500;

  const lastUser = useMemo(
    () => [...rows].reverse().find((r) => r.kind === "USER_FINAL")?.text || "",
    [rows]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <header className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-xs font-semibold tracking-wide text-amber-300">
            LOCAL VOICE LAB — NO TWILIO
          </p>
          <h1 className="text-2xl font-semibold">Talk to the SDR from this computer</h1>
          <p className="text-sm text-slate-300">
            Temporary local test only. No phone calls, no Twilio minutes, no production database
            writes, no real calendar events. Start{" "}
            <code className="text-amber-200">npm run voice:dev</code> and{" "}
            <code className="text-amber-200">npm run dev</code>, then use this page.
            {sessionId ? (
              <span className="ml-2 text-xs text-slate-400">
                session <code>{sessionId}</code>
              </span>
            ) : null}
          </p>
        </header>

        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            (activePrompt ?? promptVariant) === "lab"
              ? "border-teal-500/50 bg-teal-500/10 text-teal-200"
              : "border-sky-500/50 bg-sky-500/10 text-sky-200"
          }`}
        >
          <span className="text-xs uppercase tracking-wide opacity-70">
            {running ? "Active prompt" : "Selected prompt"}
          </span>{" "}
          <strong>{VOICE_LAB_PROMPT_LABELS[activePrompt ?? promptVariant]}</strong>
          <span className="ml-2 text-xs opacity-70">
            — same Gemini/VAD/TTS/turn machine for both; only the prompt text changes.
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr_340px]">
          <section className="space-y-3">
            <Panel title="Session">
              <label className="block text-xs text-slate-400">Prompt (A/B)</label>
              <div className="mt-1 grid grid-cols-1 gap-1">
                {VOICE_LAB_PROMPT_VARIANTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={running || starting}
                    onClick={() => setPromptVariant(v)}
                    className={`rounded px-2 py-2 text-left text-xs ${
                      promptVariant === v
                        ? v === "lab"
                          ? "bg-teal-700"
                          : "bg-sky-700"
                        : "bg-slate-800"
                    }`}
                  >
                    {VOICE_LAB_PROMPT_LABELS[v]}
                    {v === "lab" ? " (default)" : ""}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-xs text-slate-400">Scenario</label>
              <select
                className="mt-1 w-full rounded-md bg-slate-900 px-2 py-2 text-sm"
                disabled={running || starting}
                value={scenarioId}
                onChange={(e) => setScenarioId(e.target.value as VoiceLabScenarioId)}
              >
                {VOICE_LAB_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-400">
                VAD silence (sent to Gemini):{" "}
                <strong className="text-slate-100">{vadSilenceMs} ms</strong>
              </p>
              <input
                type="range"
                min={400}
                max={1200}
                step={50}
                disabled={running || starting}
                value={vadSilenceMs}
                onChange={(e) => setVadSilenceMs(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex flex-wrap gap-1">
                {VOICE_LAB_VAD_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={running || starting}
                    onClick={() => setVadSilenceMs(v)}
                    className={`rounded px-2 py-1 text-xs ${
                      vadSilenceMs === v ? "bg-teal-700" : "bg-slate-800"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">Deepgram speed (lab only)</p>
              <div className="flex flex-wrap gap-1">
                {VOICE_LAB_TTS_SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={running || starting}
                    onClick={() => setTtsSpeed(s)}
                    className={`rounded px-2 py-1 text-xs ${
                      ttsSpeed === s ? "bg-teal-700" : "bg-slate-800"
                    }`}
                  >
                    {s.toFixed(2)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Phone latency sim (lab only):{" "}
                <strong className="text-slate-100">{latencyPreset}</strong>
              </p>
              <div className="flex flex-wrap gap-1">
                {VOICE_LAB_LATENCY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={running || starting}
                    onClick={() => setLatencyPreset(p.id)}
                    className={`rounded px-2 py-1 text-xs ${
                      latencyPreset === p.id ? "bg-teal-700" : "bg-slate-800"
                    }`}
                  >
                    {p.id === "normal" ? "NORMAL" : `+${p.id}`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={starting}
                onClick={running ? endConversation : () => void startConversation()}
                className={`mt-3 w-full rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-60 ${
                  running ? "bg-red-700 hover:bg-red-600" : "bg-teal-600 hover:bg-teal-500"
                }`}
              >
                {starting ? "Starting…" : running ? "End Conversation" : "Start Conversation"}
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Hands-free: the mic stays on for the whole session. Speak, pause, interrupt.
              </p>
              {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
              {warning ? <p className="mt-2 text-xs text-amber-300">⚠ {warning}</p> : null}
            </Panel>

            <Panel title="Microphone">
              <Status ok={conn.microphone} label={`MIC: ${conn.microphone ? "CONNECTED" : "OFF"}`} />
              <Status
                ok={audioReceiving}
                label={`AUDIO: ${
                  audioReceiving
                    ? `RECEIVING (${audioStats?.framesReceived ?? 0} frames)`
                    : running
                      ? "NOT REACHING SERVER"
                      : "IDLE"
                }`}
              />
              <Status
                ok={audioStats?.forwardingToGemini ?? false}
                label={`GEMINI INPUT: ${audioStats?.forwardingToGemini ? "STREAMING" : "—"}`}
              />
              <p className="mt-2 text-sm">
                USER:{" "}
                <span className={userSpeaking ? "font-semibold text-emerald-300" : "text-slate-400"}>
                  {userSpeaking ? "SPEAKING" : "SILENT"}
                </span>
              </p>
              <div className="mt-2 h-3 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full transition-[width] duration-75 ${
                    userSpeaking ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.round(micLevel * 600))}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                level {micLevel.toFixed(3)} · start &gt; {MIC_START_RMS} (AI playing &gt;{" "}
                {MIC_START_RMS_WHILE_AI_SPEAKING} for ~{Math.round((MIC_START_FRAMES_WHILE_AI * 2048) / 48)}
                ms) · stop &lt; {MIC_STOP_RMS} for {MIC_STOP_MS}ms
              </p>
            </Panel>

            <Panel title="Test lines">
              <ul className="space-y-1 text-xs text-slate-300">
                {VOICE_LAB_TEST_LINES.map((line) => (
                  <li key={line}>“{line}”</li>
                ))}
              </ul>
            </Panel>
          </section>

          <section className="space-y-3">
            <Panel title="Turn state">
              <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold uppercase tracking-wide">
                  {turnState.replace(/_/g, " ")}
                </p>
                <p className="text-xs text-slate-400">
                  epoch {epoch} · barge-ins {interruptions} · stale audio dropped {staleDropped}
                </p>
              </div>
              <StateStrip state={turnState} />
              <p className="mt-2 text-xs text-slate-400">
                Appointment: SIMULATED — LOCAL TEST ONLY ({appointment})
              </p>
            </Panel>

            <Panel title="Transcript (USER final · AI generated · AI spoken)">
              <div className="max-h-80 space-y-1 overflow-auto text-sm">
                {rows.map((r, i) => (
                  <TranscriptLine key={`${r.at}-${i}`} row={r} />
                ))}
                {liveUser ? (
                  <p className="text-emerald-300/80">
                    <Tag>USER PARTIAL</Tag> {liveUser}
                  </p>
                ) : userSpeaking ? (
                  <p className="text-emerald-300/80">
                    <Tag>USER PARTIAL</Tag> speaking… (waiting for Gemini to finalize the utterance)
                  </p>
                ) : null}
                {liveAi ? (
                  <p className="text-sky-200/80">
                    <Tag>AI GENERATING</Tag> {liveAi}
                  </p>
                ) : null}
                {!rows.length && !liveAi && !liveUser && !userSpeaking ? (
                  <p className="text-slate-500">—</p>
                ) : null}
              </div>
              {lastUser ? (
                <p className="mt-2 text-xs text-slate-500">Last final user turn: “{lastUser}”</p>
              ) : null}
            </Panel>

            <Panel title="Timeline">
              <ol className="max-h-48 space-y-1 overflow-auto text-xs text-slate-300">
                {timeline.map((e, i) => (
                  <li key={`${e.t}-${i}`}>
                    <span className="text-slate-500">{(e.t / 1000).toFixed(2)}s</span> {e.label}
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Structured debug log ([VOICE_LAB] session / turn / response / epoch / event)">
              <ol className="max-h-64 space-y-0.5 overflow-auto font-mono text-[11px] text-slate-400">
                {logs.slice(-150).map((l, i) => (
                  <li
                    key={`${l.t}-${i}`}
                    className={
                      l.event === "VOICE_LAB_WARNING" || l.event.includes("duplicate") || l.event.includes("illegal")
                        ? "text-amber-300"
                        : l.event === "state"
                          ? "text-slate-500"
                          : ""
                    }
                  >
                    {(l.t / 1000).toFixed(2)}s turn={l.turn} resp={l.response ?? "-"} epoch={l.epoch}{" "}
                    {l.event}
                    {l.detail ? ` ${l.detail}` : ""}
                  </li>
                ))}
              </ol>
            </Panel>
          </section>

          <section className="space-y-3">
            <Panel title="Connection">
              <Status ok={conn.microphone} label="Microphone" />
              <Status ok={conn.websocket} label="WebSocket" />
              <Status ok={conn.gemini} label="Gemini Live" />
              <Status ok={conn.deepgram} label="Deepgram TTS" />
              <Status ok={conn.playback} label="Audio playback" />
            </Panel>
            <Panel title="Latency (last response)">
              <Metric label="Final transcript → first audio" value={ms(latency.userFinishedToAudioMs)} />
              <Metric label="Mic silent → first audio" value={ms(latency.micEndToAudioMs)} />
              <Metric label="Transcript → Gemini text done" value={ms(latency.geminiMs)} />
              <Metric label="TTS start → first audio" value={ms(latency.ttsMs)} />
              <Metric label="Deepgram first byte" value={ms(latency.firstByteMs)} />
            </Panel>
            <Panel title="Voice metrics">
              <Metric label="VAD silence" value={`${vadSilenceMs} ms`} />
              <Metric label="Response word count" value={wordCount ?? "—"} />
              <Metric label="AI speaking speed" value={wpm ? `${wpm} WPM` : "—"} />
              <Metric label="Barge-ins" value={interruptions} />
            </Panel>
            <Panel title="Prompt A/B results (this browser session)">
              {abResults.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Run one session with each prompt to compare. Metrics are heuristics.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left">Prompt</th>
                      <th>Score</th>
                      <th>Start ms</th>
                      <th>Words</th>
                      <th>Cut/Barge</th>
                      <th>Rep</th>
                      <th>Miss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abResults.map((r) => (
                      <tr key={r.at}>
                        <td className={r.promptVariant === "lab" ? "text-teal-300" : "text-sky-300"}>
                          {r.promptVariant === "lab" ? "B Lab" : "A Prod"}
                        </td>
                        <td className="text-center">{r.overall.toFixed(1)}</td>
                        <td className="text-center">{r.medianStartMs ?? "—"}</td>
                        <td className="text-center">{r.avgWords ?? "—"}</td>
                        <td className="text-center">
                          {r.earlyCutoffs}/{r.interruptions}
                        </td>
                        <td className="text-center">{r.repeats}</td>
                        <td className="text-center">{r.missed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel title="VAD / speed experiments">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left">Exp</th>
                    <th>VAD</th>
                    <th>Speed</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <button
                          type="button"
                          disabled={running || starting}
                          className="text-teal-300 underline"
                          onClick={() => {
                            setVadSilenceMs(e.vadSilenceMs);
                            setTtsSpeed(e.ttsSpeed);
                          }}
                        >
                          {e.id}
                        </button>
                      </td>
                      <td className="text-center">{e.vadSilenceMs}</td>
                      <td className="text-center">{e.ttsSpeed}</td>
                      <td className="text-center">{e.overall ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </section>
        </div>

        {report ? (
          <Panel title="Session report (engineering heuristics — not validated)">
            <p className="text-xs uppercase tracking-wide text-slate-400">Prompt</p>
            <p
              className={`text-sm font-semibold ${
                report.promptVariant === "lab" ? "text-teal-300" : "text-sky-300"
              }`}
            >
              {VOICE_LAB_PROMPT_LABELS[report.promptVariant]}
            </p>
            <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">Human-likeness score</p>
            <p className="text-3xl font-semibold">{report.score.overall.toFixed(1)} / 10</p>
            <p className="text-xs text-slate-500">{report.score.heuristicLabel}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {REPORT_CATEGORIES.map(({ key, label }) => (
                <div key={key} className="rounded bg-slate-900 px-3 py-2 text-sm">
                  <span className="text-slate-400">{label}</span>
                  <span className="float-right font-semibold">{report.score.breakdown[key]}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <Counter label="User turns" value={report.counters.userTurns} />
              <Counter label="AI responses spoken" value={report.counters.responsesSpoken} />
              <Counter label="Missed responses" value={report.counters.missedResponses} warn />
              <Counter label="Duplicates blocked" value={report.counters.duplicateResponsesBlocked + report.counters.duplicateTtsBlocked} />
              <Counter label="Partial attempts" value={report.counters.partialResponseAttempts} />
              <Counter label="Barge-ins" value={report.counters.bargeIns} />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Observations</p>
                {report.score.observations.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-slate-200">
                    {report.score.observations.map((o, i) => (
                      <li key={`${o}-${i}`}>{o}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">No measurements captured.</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Points lost</p>
                {report.score.deductions.length ? (
                  <ul className="mt-1 list-disc pl-5 text-sm text-amber-200">
                    {report.score.deductions.map((d, i) => (
                      <li key={`${d}-${i}`}>{d}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-300">No heuristic deductions this session.</p>
                )}
              </div>
            </div>

            <details className="mt-3 text-sm text-slate-300">
              <summary className="cursor-pointer">Per-turn timing ({report.turns.length})</summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left">Turn</th>
                    <th className="text-left">User</th>
                    <th className="text-left">AI</th>
                    <th>Outcome</th>
                    <th>Transcript→audio</th>
                    <th>Mic end→audio</th>
                    <th>AI speaking</th>
                  </tr>
                </thead>
                <tbody>
                  {report.turns.map((t) => (
                    <tr key={t.turnId} className="border-t border-slate-800">
                      <td>{t.turnId}</td>
                      <td className="max-w-[200px] truncate">{t.userText ?? "—"}</td>
                      <td className="max-w-[260px] truncate">{t.aiText ?? "—"}</td>
                      <td className="text-center">{t.outcome}</td>
                      <td className="text-center">{ms(t.transcriptToFirstAudioMs)}</td>
                      <td className="text-center">{ms(t.micEndToFirstAudioMs)}</td>
                      <td className="text-center">{ms(t.aiSpeakingMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            {report.validation.length ? (
              <details className="mt-3 text-sm text-slate-400">
                <summary className="cursor-pointer">
                  Per-response validation ({report.validation.length})
                </summary>
                <ul className="mt-1 list-disc pl-5">
                  {report.validation.slice(0, 30).map((d, i) => (
                    <li key={`${d}-${i}`}>{d}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

const STATE_ORDER: VoiceLabTurnState[] = [
  "listening",
  "user_speaking",
  "user_turn_finalizing",
  "ai_thinking",
  "ai_speaking",
];

function StateStrip({ state }: { state: VoiceLabTurnState }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
      {STATE_ORDER.map((s) => (
        <span
          key={s}
          className={`rounded px-2 py-0.5 ${
            s === state ? "bg-teal-600 text-white" : "bg-slate-800 text-slate-500"
          }`}
        >
          {s.replace(/_/g, " ")}
        </span>
      ))}
      <span
        className={`rounded px-2 py-0.5 ${
          state === "barge_in" ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-500"
        }`}
      >
        barge in
      </span>
    </div>
  );
}

function TranscriptLine({ row }: { row: VoiceLabTranscriptRow }) {
  const kind = row.kind ?? (row.speaker === "USER" ? "USER_FINAL" : "AI_GENERATED");
  const color =
    kind === "USER_FINAL"
      ? "text-emerald-200"
      : kind === "AI_GENERATED"
        ? "text-sky-200"
        : kind === "AI_SPOKEN"
          ? row.interim
            ? "text-amber-200/80"
            : "text-slate-300"
          : "text-slate-400";
  return (
    <p className={color}>
      <Tag>{kind.replace("_", " ")}</Tag>
      {typeof row.turnId === "number" ? (
        <span className="mr-1 text-[10px] text-slate-500">t{row.turnId}</span>
      ) : null}
      {typeof row.responseId === "number" ? (
        <span className="mr-1 text-[10px] text-slate-500">r{row.responseId}</span>
      ) : null}
      {row.text}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-300">
      {children}
    </span>
  );
}

function Counter({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded bg-slate-900 px-3 py-2">
      <p className="text-slate-400">{label}</p>
      <p className={`text-lg font-semibold ${warn && value > 0 ? "text-amber-300" : ""}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
      {children}
    </div>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="text-sm">
      <span className={ok ? "text-emerald-400" : "text-slate-500"}>●</span> {label}
    </p>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <p className="flex justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span>{value}</span>
    </p>
  );
}

function ms(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Math.round(v)} ms`;
}
