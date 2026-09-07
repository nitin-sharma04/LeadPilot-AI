/**
 * Spoken booking confirmation from the real booking result — not conversational guesswork.
 */

export function formatIstFriendlyWhen(displayWhen?: string, timezone?: string): string {
  const tz = (timezone || "").toLowerCase();
  const when = (displayWhen || "").trim();
  if (!when) return "";
  if (tz.includes("kolkata") || tz.includes("calcutta") || tz === "asia/kolkata") {
    if (/\bist\b/i.test(when)) return when;
    return `${when} IST`;
  }
  return when;
}

export function spokenBookingSuccess(input: {
  displayWhen?: string;
  timezone?: string;
}): string {
  const when = formatIstFriendlyWhen(input.displayWhen, input.timezone);
  if (when) {
    return `You're booked for ${when}. I'll send the calendar details.`;
  }
  return "You're booked. I'll send the calendar details.";
}

export function spokenBookingFailure(): string {
  return "I couldn't complete that booking just now. Want to try another time?";
}

export function spokenTimeConfirm(dateHint: string | null, timeHint: string | null): string | null {
  if (!dateHint || !timeHint) return null;
  return `${dateHint} at ${timeHint} — does that work?`;
}
