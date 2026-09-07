/**
 * TTS provider selection.
 * Default is Deepgram Flux TTS. Gemini native audio is the fallback
 * (VOICE_TTS_PROVIDER=gemini, or missing DEEPGRAM_API_KEY).
 */

export type VoiceTtsProvider = "gemini" | "deepgram";

export function resolveVoiceTtsProvider(
  value: string | undefined = process.env.VOICE_TTS_PROVIDER
): VoiceTtsProvider {
  const raw = (value || "deepgram").trim().toLowerCase();
  if (raw === "gemini") return "gemini";
  return "deepgram";
}

export function isDeepgramTtsEnabled(): boolean {
  return resolveVoiceTtsProvider() === "deepgram";
}
