/**
 * Only finalized agent speech may reach Deepgram.
 * Never synthesize internal coaching / events / partial fragments.
 */

const INTERNAL_RE = /\[INTERNAL\][\s\S]*/gi;
const EVENT_RE = /\[EVENT:[^\]]*\]/gi;

export function toSpeakableAgentText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/^(SYSTEM|DEBUG|TOOL)\s*:/i.test(text)) return null;
  text = text.replace(INTERNAL_RE, "").replace(EVENT_RE, "").replace(/\s+/g, " ").trim();
  text = text.replace(/^(SYSTEM|DEBUG|TOOL)\s*:/gi, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text === "[unclear]") return null;
  if (/^(uh+|um+|er+|ah+)$/i.test(text)) return null;
  if (
    /do not read this tag aloud|follow the fact|appt=|booking_ok|booking_fail|speech_pace=/i.test(
      text
    )
  ) {
    return null;
  }
  return text;
}

/** Flux TTS is English-only at launch. Do not invent Hindi support. */
export function isLikelyUnsupportedForFluxEnglish(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

export function shouldSkipDuplicateSynthesis(
  previous: string | null,
  next: string
): boolean {
  if (!next) return true;
  if (!previous) return false;
  return previous.replace(/\s+/g, " ").trim() === next.replace(/\s+/g, " ").trim();
}
