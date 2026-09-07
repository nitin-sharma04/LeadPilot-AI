/**
 * Lightweight transcript normalization — never invents meaning.
 * (Mirrored in src/lib/voice/transcript-cleanup.ts for the Next.js app.)
 */

export function isInternalTranscript(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/\[INTERNAL\]/i.test(t)) return true;
  if (/\[EVENT:/i.test(t)) return true;
  if (/^\[system\]/i.test(t)) return true;
  if (/\bbooking_ok\b|\bbooking_fail\b|\bspeech_pace=/i.test(t)) return true;
  if (/do not read this tag aloud|follow the fact/i.test(t)) return true;
  if (/^(SYSTEM|DEBUG|TOOL)\s*:/i.test(t)) return true;
  return false;
}

/**
 * Merge streaming STT chunks into one utterance.
 * Prefer cumulative replacements over concatenating duplicates.
 */
export function mergeStreamingTranscript(buffer: string, chunk: string): string {
  const b = buffer.replace(/\s+/g, " ").trim();
  const c = chunk.replace(/\s+/g, " ").trim();
  if (!c) return b;
  if (!b) return c;
  if (c === b) return b;
  if (c.startsWith(b) || c.includes(b)) return c;
  if (b.startsWith(c) || b.includes(c)) return b;
  const bHead = b.slice(0, Math.min(16, b.length)).toLowerCase();
  const cHead = c.slice(0, Math.min(16, c.length)).toLowerCase();
  if (
    bHead &&
    cHead &&
    (b.toLowerCase().startsWith(cHead) || c.toLowerCase().startsWith(bHead))
  ) {
    return c.length >= b.length ? c : b;
  }
  return `${b} ${c}`.trim();
}

/**
 * Decide whether a buffered lead utterance should appear in the user-facing transcript.
 * Empty / interim-only / uh-um / internal events must not become "[unclear]".
 */
export function finalizeLeadUtterance(
  raw: string,
  lastLead: string | null | undefined
): string | null {
  if (isInternalTranscript(raw)) return null;
  const text = normalizeTranscriptText(raw);
  if (!text) return null;
  if (/^(uh+|um+|er+|ah+|\.\.\.|…)$/i.test(text)) return null;
  if (text === "[unclear]" && lastLead === "[unclear]") return null;
  if (shouldSkipDuplicate(lastLead, text)) return null;
  return text;
}

export function normalizeTranscriptText(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";

  text = text.replace(/\b([A-Za-z0-9']{2,})\s+\1\b/gi, "$1");

  text = text.replace(
    /\b(\d{1,2})\s*(am|pm)\b/gi,
    (_, h: string, mer: string) => `${h} ${mer.toUpperCase()}`
  );
  text = text.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()
  );

  if (/^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  if (
    text.length > 12 &&
    /[a-z0-9]$/i.test(text) &&
    !/[.!?]$/.test(text) &&
    /\b(thanks|thank you|goodbye|bye|okay|ok|yes|no|sure)\b/i.test(text)
  ) {
    text = `${text}.`;
  }

  return text.trim();
}

export function shouldSkipDuplicate(
  previous: string | null | undefined,
  next: string
): boolean {
  const a = (previous || "").replace(/\s+/g, " ").trim().toLowerCase();
  const b = next.replace(/\s+/g, " ").trim().toLowerCase();
  if (!b) return true;
  if (!a) return false;
  if (a === b) return true;
  if (a.includes(b) && a.length - b.length < 40) return true;
  return false;
}

export function markUnclearIfEmpty(text: string): string {
  const t = text.trim();
  if (!t) return "[unclear]";
  if (/^(uh+|um+|er+|ah+)$/i.test(t)) return "[unclear]";
  return t;
}
