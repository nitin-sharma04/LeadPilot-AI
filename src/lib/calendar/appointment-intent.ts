/**
 * Structured appointment intent extracted from voice transcripts.
 * Prefer explicit clock times; map IST → Asia/Kolkata; never invent Pacific.
 */

import {
  parsePreferredMeetingTime,
  type ParsedMeetingTime,
} from "./parse-meeting-time";
import { assertTimezone, isValidIanaTimezone } from "./timezone";
import { TIMEZONE_ALIASES, resolveTimezoneAlias } from "./timezone-aliases";
import { isClearAppointmentConfirmation } from "@/lib/voice/end-call-intent";

export type AppointmentIntentStatus =
  | "none"
  | "proposed"
  | "awaiting_confirmation"
  | "confirmed"
  | "booked"
  | "declined"
  | "failed";

export type AppointmentIntent = {
  status: AppointmentIntentStatus;
  preferredText: string;
  timezone: string;
  parsed: ParsedMeetingTime | null;
  confirmed: boolean;
  ambiguous: boolean;
  source: "transcript" | "summary" | "structured";
};

export function extractTimezoneFromText(
  text: string,
  fallback: string
): string {
  const aliased = resolveTimezoneAlias(text);
  if (aliased) return aliased;
  try {
    return assertTimezone(fallback);
  } catch {
    return "UTC";
  }
}

/**
 * Build a single preferred phrase from multi-turn lead speech.
 * Explicit numeric times win over "morning/afternoon/evening".
 */
export function buildPreferredPhraseFromTranscript(
  transcripts: Array<{ speaker: string; text: string }>
): string {
  const leadLines = transcripts
    .filter((t) => {
      const s = t.speaker.toUpperCase();
      return s === "LEAD" || s === "CUSTOMER";
    })
    .map((t) => t.text.replace(/\s+/g, " ").trim())
    .filter((t) => t && t !== "[unclear]");

  const dayHints: string[] = [];
  const timeHints: string[] = [];
  const tzHints: string[] = [];

  for (const line of leadLines) {
    const lower = line.toLowerCase();
    if (/\b(today|tomorrow)\b/i.test(line) || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(line)) {
      const day = line.match(
        /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
      );
      if (day) dayHints.push(day[0]);
    }
    const clock = line.match(/\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    if (clock) {
      timeHints.push(clock[0]);
    }
    if (TIMEZONE_ALIASES.some((a) => a.re.test(line))) {
      const alias = TIMEZONE_ALIASES.find((a) => a.re.test(line));
      const token = alias ? line.match(alias.re)?.[0] : null;
      if (token) tzHints.push(token);
    }
    // Ignore pure "afternoon" without a clock — only attach if we already have a time
    if (
      /\b(morning|afternoon|evening)\b/i.test(lower) &&
      !/\d/.test(lower) &&
      timeHints.length > 0
    ) {
      // skip storing vague period as the time itself
    }
  }

  // Prefer the most recent day + most recent explicit time + most recent tz
  const day = dayHints[dayHints.length - 1] || "";
  const time = timeHints[timeHints.length - 1] || "";
  const tz = tzHints[tzHints.length - 1] || "";

  const parts: string[] = [];
  for (const p of [day, time, tz]) {
    if (!p) continue;
    if (parts.some((existing) => existing === p || existing.includes(p) || p.includes(existing))) {
      // Prefer the longer/more complete fragment
      const idx = parts.findIndex(
        (existing) => existing === p || existing.includes(p) || p.includes(existing)
      );
      if (idx >= 0 && p.length > parts[idx].length) parts[idx] = p;
      continue;
    }
    parts.push(p);
  }
  if (parts.length === 0) {
    return "";
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function isLeadSpeaker(speaker: string) {
  const s = speaker.toUpperCase();
  return s === "LEAD" || s === "CUSTOMER";
}

function lineHasScheduleHint(text: string): boolean {
  return (
    /\b(today|tomorrow)\b/i.test(text) ||
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      text
    ) ||
    /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(text) ||
    TIMEZONE_ALIASES.some((a) => a.re.test(text))
  );
}

/**
 * Confirmation only counts after a schedule proposal (avoids early "okay"/"yes").
 * Same-turn phrases like "tomorrow at 4 PM works" also count.
 */
export function transcriptHasConfirmation(
  transcripts: Array<{ speaker: string; text: string }>
): boolean {
  let lastProposalIdx = -1;
  for (let i = 0; i < transcripts.length; i += 1) {
    const t = transcripts[i];
    if (!isLeadSpeaker(t.speaker)) continue;
    if (lineHasScheduleHint(t.text)) lastProposalIdx = i;
    // Self-confirming proposal
    if (
      lineHasScheduleHint(t.text) &&
      isClearAppointmentConfirmation(t.text)
    ) {
      return true;
    }
  }
  if (lastProposalIdx < 0) return false;
  for (let i = lastProposalIdx + 1; i < transcripts.length; i += 1) {
    const t = transcripts[i];
    if (!isLeadSpeaker(t.speaker)) continue;
    if (isClearAppointmentConfirmation(t.text)) return true;
  }
  return false;
}

export function resolveAppointmentIntent(input: {
  transcripts: Array<{ speaker: string; text: string }>;
  companyTimezone?: string | null;
  summaryPreferredTime?: string | null;
  now?: Date;
}): AppointmentIntent {
  const fallbackTz =
    input.companyTimezone && isValidIanaTimezone(input.companyTimezone)
      ? input.companyTimezone
      : "UTC";

  const fromTranscript = buildPreferredPhraseFromTranscript(input.transcripts);
  const preferredText =
    fromTranscript ||
    (input.summaryPreferredTime || "").trim() ||
    "";

  if (!preferredText) {
    return {
      status: "none",
      preferredText: "",
      timezone: fallbackTz,
      parsed: null,
      confirmed: false,
      ambiguous: true,
      source: "transcript",
    };
  }

  const timezone = extractTimezoneFromText(preferredText, fallbackTz);
  const parsed = parsePreferredMeetingTime({
    text: preferredText,
    timezone,
    now: input.now,
  });

  // If summary has a cleaner phrase and transcript parse failed, try summary
  let source: AppointmentIntent["source"] = "transcript";
  let finalParsed = parsed;
  let finalPreferred = preferredText;
  if ((!parsed || parsed.ambiguous) && input.summaryPreferredTime?.trim()) {
    const summaryTz = extractTimezoneFromText(
      input.summaryPreferredTime,
      timezone
    );
    const summaryParsed = parsePreferredMeetingTime({
      text: input.summaryPreferredTime.trim(),
      timezone: summaryTz,
      now: input.now,
    });
    if (summaryParsed && !summaryParsed.ambiguous) {
      finalParsed = summaryParsed;
      finalPreferred = input.summaryPreferredTime.trim();
      source = "summary";
    }
  }

  const confirmed = transcriptHasConfirmation(input.transcripts);
  const ambiguous = !finalParsed || finalParsed.ambiguous;

  let status: AppointmentIntentStatus = "none";
  if (ambiguous && preferredText) status = "proposed";
  else if (!ambiguous && !confirmed) status = "awaiting_confirmation";
  else if (!ambiguous && confirmed) status = "confirmed";

  return {
    status,
    preferredText: finalPreferred,
    timezone: finalParsed?.timezone || timezone,
    parsed: finalParsed,
    confirmed,
    ambiguous,
    source,
  };
}
