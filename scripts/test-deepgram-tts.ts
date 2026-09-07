/**
 * LOCAL EXPERIMENT — standalone Deepgram TTS listen test.
 * Does not touch Twilio or production.
 *
 * Run: npm run test:deepgram-tts
 *
 * Requires DEEPGRAM_API_KEY in .env.local
 * Never prints the API key.
 */
import { createWriteStream, mkdirSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import {
  DeepgramTtsSession,
  loadDeepgramTtsConfig,
} from "../voice-server/src/tts/deepgram-tts";
import { resolveVoiceTtsProvider } from "../voice-server/src/tts/tts-provider";

const SAMPLES = [
  {
    name: "package",
    text: "So I can see here that the package was marked as delivered on Tuesday, but if you're saying it never arrived then what we'll do is... let me just... Yeah, I'm going to open a lost package investigation for you. That usually takes about 48 hours to resolve.",
  },
  {
    name: "sdr",
    text: "Hey Sarah, it's Alex from Apex Digital Solutions. I saw you were looking at getting a website for your dental clinic. Do you have a quick minute?",
  },
  {
    name: "appointment",
    text: "That sounds good. What day works best for you? And roughly what time would you prefer?",
  },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const provider = resolveVoiceTtsProvider();
  const cfg = loadDeepgramTtsConfig();
  assert(Boolean(process.env.DEEPGRAM_API_KEY?.trim()), "DEEPGRAM_API_KEY is missing");
  assert(Boolean(cfg), "Deepgram config failed to load");
  if (!cfg) return;

  console.log("[test:deepgram-tts] client initialized");
  console.log("[test:deepgram-tts] model=", cfg.model);
  console.log("[test:deepgram-tts] speed=", cfg.speed);
  console.log("[test:deepgram-tts] expressivity=", cfg.expressivity);
  console.log("[test:deepgram-tts] VOICE_TTS_PROVIDER=", provider, "(default remains gemini)");

  const outDir = path.resolve(process.cwd(), "audio");
  mkdirSync(outDir, { recursive: true });

  const session = new DeepgramTtsSession(cfg);

  const mp3 = await session.synthesizeMp3(SAMPLES[0].text);
  assert(mp3.length > 1000, "mp3 too small");
  const mp3Path = path.join(outDir, "deepgram-test.mp3");
  await pipeline(Readable.from(mp3), createWriteStream(mp3Path));
  const mp3Stat = statSync(mp3Path);
  assert(mp3Stat.size > 1000, "mp3 file empty");
  console.log("[test:deepgram-tts] wrote", mp3Path, "bytes=", mp3Stat.size);

  const ulawChunks: Buffer[] = [];
  const t0 = Date.now();
  let firstAudioMs: number | null = null;
  for await (const chunk of session.synthesizeMulaw8k(SAMPLES[1].text)) {
    if (firstAudioMs === null) firstAudioMs = Date.now() - t0;
    ulawChunks.push(chunk);
  }
  const ulaw = Buffer.concat(ulawChunks);
  assert(ulaw.length > 160, "µ-law too small (expected >20ms)");
  const ulawPath = path.join(outDir, "deepgram-test.ulaw");
  await pipeline(Readable.from(ulaw), createWriteStream(ulawPath));
  const ulawStat = statSync(ulawPath);
  assert(ulawStat.size === ulaw.length, "µ-law size mismatch");
  const durationMs = Math.round((ulaw.length / 8000) * 1000);
  console.log("[test:deepgram-tts] wrote", ulawPath, "bytes=", ulawStat.size, "approxDurationMs=", durationMs);
  console.log("[test:deepgram-tts] firstAudioMs=", firstAudioMs);

  for (const sample of SAMPLES.slice(2)) {
    const extra: Buffer[] = [];
    for await (const chunk of new DeepgramTtsSession(cfg).synthesizeMulaw8k(sample.text)) {
      extra.push(chunk);
    }
    const buf = Buffer.concat(extra);
    assert(buf.length > 160, `${sample.name} µ-law empty`);
    console.log("[test:deepgram-tts] sample", sample.name, "mulawBytes=", buf.length);
  }

  console.log("[test:deepgram-tts] passed (listen to audio/deepgram-test.mp3)");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown";
  console.error("[test:deepgram-tts] failed:", message.replace(/token|api[_-]?key|authorization/gi, "[redacted]"));
  process.exit(1);
});
