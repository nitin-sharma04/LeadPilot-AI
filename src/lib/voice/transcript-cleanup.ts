/**
 * Lightweight transcript normalization — never invents meaning.
 */

export function normalizeTranscriptText(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // Collapse obvious duplicated adjacent fragments: "hello hello" → "hello"
  text = text.replace(/\b([A-Za-z0-9']{2,})\s+\1\b/gi, "$1");

  // Normalize common time phrases (do not invent)
  text = text.replace(
    /\b(\d{1,2})\s*(am|pm)\b/gi,
    (_, h: string, mer: string) => `${h} ${mer.toUpperCase()}`
  );
  text = text.replace(
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    (d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()
  );

  // Light punctuation: capitalize first letter if alphabetic
  if (/^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Ensure sentence end if clearly a complete sentence without punctuation
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

/** Deduplicate if new text is equal to or a prefix/suffix extension of previous. */
export function shouldSkipDuplicate(
  previous: string | null | undefined,
  next: string
): boolean {
  const a = (previous || "").replace(/\s+/g, " ").trim().toLowerCase();
  const b = next.replace(/\s+/g, " ").trim().toLowerCase();
  if (!b) return true;
  if (!a) return false;
  if (a === b) return true;
  if (b.startsWith(a) && b.length - a.length < 8) return false; // allow extension
  if (a.includes(b) && a.length - b.length < 40) return true;
  return false;
}

export function markUnclearIfEmpty(text: string): string {
  const t = text.trim();
  if (!t) return "[unclear]";
  if (/^(uh+|um+|er+|ah+)$/i.test(t)) return "[unclear]";
  return t;
}
