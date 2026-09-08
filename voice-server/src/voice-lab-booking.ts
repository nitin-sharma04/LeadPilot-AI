import { AppointmentIntentTracker } from "./appointment-intent-tracker.js";

export type LabBookingResult =
  | { status: "none" }
  | { status: "BOOKED_SIMULATED"; spoken: string; preferredText: string };

/** Short spoken time phrase: prefer parsed date/time hints; never echo whole sentences twice. */
export function labBookingWhen(
  dateHint: string | null | undefined,
  timeHint: string | null | undefined,
  fallback: string
): string {
  const parts = [dateHint, timeHint].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length) return parts.join(" at ").replace(/\s+/g, " ").trim();
  // Fallback: first clause only, without trailing "works"/punctuation, deduplicated.
  const clause = fallback
    .replace(/\s+/g, " ")
    .split(/[.!?]/)[0]
    .replace(/\b(works|sounds good|is fine|is good|for me)\b.*$/i, "")
    .trim();
  return clause || "that time";
}

export function spokenLabBookingSuccess(when: string): string {
  const w = when.replace(/\s+/g, " ").trim() || "that time";
  return `Okay, ${w} is locked in for this test. No calendar invite was sent.`;
}

export function trySimulateLabBooking(
  tracker: AppointmentIntentTracker,
  leadText: string
): LabBookingResult {
  if (!tracker.shouldAttemptBooking(leadText)) return { status: "none" };
  tracker.markBookingAttempted();
  const preferred = labBookingWhen(tracker.dateHint, tracker.timeHint, tracker.preferredText || leadText);
  tracker.markBooked();
  return {
    status: "BOOKED_SIMULATED",
    spoken: spokenLabBookingSuccess(preferred),
    preferredText: preferred,
  };
}
