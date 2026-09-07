/**
 * Guard spoken agent text: never send internal markers or false booking claims to TTS.
 */

import { spokenTimeConfirm } from "./booking-speech.js";
import { toSpeakableAgentText } from "./speakable-text.js";

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

export function claimsPrematureBooking(text: string): boolean {
  return (
    /\b(i('?ll| will) send (over )?(an |the )?(calendar )?invite)\b/i.test(text) ||
    /\b(i('?ll| will) send (over )?(the )?calendar details)\b/i.test(text) ||
    /\byou('?re| are) (all set|booked)\b/i.test(text) ||
    /\bi('?ve| have) booked\b/i.test(text) ||
    /\bi('?ve| have) got you down\b/i.test(text) ||
    /\bit('?s| is) on the calendar\b/i.test(text) ||
    /\bcalendar invite\b/i.test(text) ||
    /\binvite should be in your inbox\b/i.test(text)
  );
}

export function stripBookingSuccessLanguage(text: string): string {
  return text
    .replace(
      /[^.?!]*\b(i('?ll| will) send (over )?(an |the )?(calendar )?invite)[^.?!]*[.?!]?/gi,
      ""
    )
    .replace(
      /[^.?!]*\b(i('?ll| will) send (over )?(the )?calendar details)[^.?!]*[.?!]?/gi,
      ""
    )
    .replace(/[^.?!]*\byou('?re| are) (all set|booked)[^.?!]*[.?!]?/gi, "")
    .replace(/[^.?!]*\bi('?ve| have) booked[^.?!]*[.?!]?/gi, "")
    .replace(/[^.?!]*\bi('?ve| have) got you down[^.?!]*[.?!]?/gi, "")
    .replace(/[^.?!]*\bit('?s| is) on the calendar[^.?!]*[.?!]?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function prepareSpokenAgentText(
  raw: string | null | undefined,
  opts: {
    hasBooked: boolean;
    dateHint?: string | null;
    timeHint?: string | null;
  }
): string | null {
  const base = toSpeakableAgentText(raw);
  if (!base) return null;
  if (isInternalTranscript(base)) return null;
  if (opts.hasBooked) return base;
  if (claimsPrematureBooking(base)) {
    const confirm = spokenTimeConfirm(opts.dateHint ?? null, opts.timeHint ?? null);
    if (confirm) return confirm;
    const stripped = stripBookingSuccessLanguage(base);
    return stripped ? toSpeakableAgentText(stripped) : null;
  }
  return base;
}
