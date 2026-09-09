/**
 * Voice-server runtime config (no secrets logged).
 */

export const GEMINI_LIVE_VOICES = [
  "Aoede",
  "Callirrhoe",
  "Achird",
  "Zubenelgenubi",
  "Sulafat",
] as const;

export type GeminiLiveVoice = (typeof GEMINI_LIVE_VOICES)[number];

const DEFAULT_VOCABULARY = [
  "Apex Digital Solutions",
  "Apex Dental",
  "LeadPilot",
  "Alex",
  "online booking",
  "appointment booking",
  "calendar",
  "website",
  "SEO",
  "Google Ads",
  "CRM",
  "discovery call",
  "sales",
  "digital marketing",
];

export function resolveGeminiLiveVoice(
  value: string | undefined = process.env.GEMINI_LIVE_VOICE
): GeminiLiveVoice {
  const raw = (value || "Aoede").trim();
  const match = GEMINI_LIVE_VOICES.find(
    (v) => v.toLowerCase() === raw.toLowerCase()
  );
  return match || "Aoede";
}

export function resolveCustomVocabulary(extra: string[] = []): string[] {
  const fromEnv = (process.env.GEMINI_LIVE_VOCABULARY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_VOCABULARY, ...fromEnv, ...extra]));
}

export function getLiveModel(): string {
  return (
    process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.1-flash-live-preview"
  );
}

/** Defensive ceiling for realtime calls (seconds). Default 600. */
export function getMaxCallDurationSeconds(): number {
  const raw = Number.parseInt(
    process.env.VOICE_MAX_CALL_DURATION_SECONDS || "600",
    10
  );
  if (!Number.isFinite(raw) || raw < 60) return 600;
  return Math.min(raw, 3600);
}

/**
 * Gemini Live end-of-speech silence (ms). Default 900.
 * Clamp 400–1200. Never silently clamp 900/1000 down to 750.
 */
export function getVadSilenceMs(
  value: string | undefined = process.env.GEMINI_VAD_SILENCE_MS
): number {
  const raw = Number.parseInt(value || "900", 10);
  if (!Number.isFinite(raw)) return 900;
  return Math.min(1200, Math.max(400, raw));
}

/**
 * After AI audio has actually played, ignore false "user silence / echo"
 * turn completions. This is a guard, not a timer that generates speech.
 * Default 650ms. Clamp 400–3000.
 */
export function getPostSpeechGuardMs(
  value: string | undefined = process.env.VOICE_POST_SPEECH_GUARD_MS
): number {
  const raw = Number.parseInt(value || "650", 10);
  if (!Number.isFinite(raw)) return 650;
  return Math.min(3000, Math.max(400, raw));
}

/**
 * Ignore tiny noise/echo bursts as barge-in during AI playback.
 * Default 170ms. Clamp 80–800. Short "yes"/"wait"/"no" still pass.
 */
export function getBargeInMinSpeechMs(
  value: string | undefined = process.env.VOICE_BARGE_IN_MIN_SPEECH_MS
): number {
  const raw = Number.parseInt(value || "170", 10);
  if (!Number.isFinite(raw)) return 170;
  return Math.min(800, Math.max(80, raw));
}

/**
 * When Gemini omits inputTranscription.finished, wait this long after the
 * last input chunk before treating the utterance as complete.
 * Default 350ms. Clamp 200–1200.
 * VOICE_INPUT_FINALIZE_DEBOUNCE_MS preferred; VOICE_INPUT_FINALIZE_MS still works.
 */
export function getInputFinalizeDebounceMs(
  value: string | undefined =
    process.env.VOICE_INPUT_FINALIZE_DEBOUNCE_MS ||
    process.env.VOICE_INPUT_FINALIZE_MS
): number {
  const raw = Number.parseInt(value || "350", 10);
  if (!Number.isFinite(raw)) return 350;
  return Math.min(1200, Math.max(200, raw));
}

/**
 * Optional holding utterance while Gemini Live is slow.
 * Default false — never used as a generation trigger.
 */
export function isVoiceFillerEnabled(
  value: string | undefined = process.env.VOICE_ENABLE_FILLER
): boolean {
  const v = (value || "false").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Phone-safe end-of-speech: LOW waits through short pauses. */
export function getVadEndSensitivity(
  value: string | undefined = process.env.GEMINI_VAD_END_SENSITIVITY
): "END_SENSITIVITY_HIGH" | "END_SENSITIVITY_LOW" {
  const raw = (value || "END_SENSITIVITY_LOW").trim().toUpperCase();
  if (raw === "END_SENSITIVITY_HIGH" || raw === "HIGH") return "END_SENSITIVITY_HIGH";
  return "END_SENSITIVITY_LOW";
}

/** Prefix padding (ms) kept with the detected utterance. Default 120. Clamp 20–300. */
export function getVadPrefixPaddingMs(
  value: string | undefined = process.env.GEMINI_VAD_PREFIX_PADDING_MS
): number {
  const raw = Number.parseInt(value || "120", 10);
  if (!Number.isFinite(raw)) return 120;
  return Math.min(300, Math.max(20, raw));
}

/** Drop inbound frames below this RMS while AI is speaking (echo). Default 500. */
export function getEchoRmsThreshold(
  value: string | undefined = process.env.VOICE_ECHO_RMS_THRESHOLD
): number {
  const raw = Number.parseInt(value || "500", 10);
  if (!Number.isFinite(raw)) return 500;
  return Math.min(4000, Math.max(50, raw));
}

export function isVoiceLatencyDebugEnabled(): boolean {
  const v = (process.env.VOICE_LATENCY_DEBUG || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  return (process.env.NODE_ENV || "development") !== "production";
}

function parseNonNegInt(value: string | undefined, fallback: number): number {
  const raw = Number.parseInt(value || String(fallback), 10);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return raw;
}

/**
 * Local Voice Lab / tests only. Always 0 in production.
 * Simulates Twilio/cellular delay so lab can reproduce phone races.
 */
export function getVoiceLabNetworkDelayMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  if ((env.NODE_ENV || "").trim().toLowerCase() === "production") return 0;
  return Math.min(2000, parseNonNegInt(env.VOICE_LAB_NETWORK_DELAY_MS, 0));
}

export function getVoiceLabJitterMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  if ((env.NODE_ENV || "").trim().toLowerCase() === "production") return 0;
  return Math.min(800, parseNonNegInt(env.VOICE_LAB_JITTER_MS, 0));
}
