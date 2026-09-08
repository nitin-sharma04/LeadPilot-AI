export function isVoiceLabEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const nodeEnv = (env.NODE_ENV || "development").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  const flag = (env.VOICE_LAB_ENABLED || "true").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return true;
}

export function clampLabVadMs(raw: number): number {
  if (!Number.isFinite(raw)) return 900;
  return Math.min(1200, Math.max(400, Math.round(raw)));
}

export function clampLabTtsSpeed(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1.2, Math.max(0.8, raw));
}

export function countWords(text: string): number {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
}

export function estimateWpm(words: number, durationMs: number): number | null {
  if (words <= 0 || durationMs < 200) return null;
  return Math.round((words / durationMs) * 60000);
}

export type VoiceLabLatencyPresetId =
  | "normal"
  | "300ms"
  | "500ms"
  | "700ms"
  | "1000ms";

export type VoiceLabLatencyProfile = {
  id: VoiceLabLatencyPresetId;
  inboundMs: number;
  outboundMs: number;
  jitterMs: number;
  transcriptMs: number;
  ttsMs: number;
};

export const VOICE_LAB_LATENCY_PRESETS: VoiceLabLatencyProfile[] = [
  { id: "normal", inboundMs: 0, outboundMs: 0, jitterMs: 0, transcriptMs: 0, ttsMs: 0 },
  { id: "300ms", inboundMs: 300, outboundMs: 300, jitterMs: 40, transcriptMs: 80, ttsMs: 60 },
  { id: "500ms", inboundMs: 500, outboundMs: 500, jitterMs: 60, transcriptMs: 120, ttsMs: 80 },
  { id: "700ms", inboundMs: 700, outboundMs: 700, jitterMs: 80, transcriptMs: 160, ttsMs: 100 },
  { id: "1000ms", inboundMs: 1000, outboundMs: 1000, jitterMs: 100, transcriptMs: 200, ttsMs: 120 },
];

export function resolveVoiceLabLatencyPreset(
  value: string | undefined | null
): VoiceLabLatencyProfile {
  const id = (value || "normal").trim().toLowerCase();
  return (
    VOICE_LAB_LATENCY_PRESETS.find((p) => p.id === id || p.id === `${id}ms`) ||
    VOICE_LAB_LATENCY_PRESETS[0]
  );
}
