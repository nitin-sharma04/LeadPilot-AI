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
