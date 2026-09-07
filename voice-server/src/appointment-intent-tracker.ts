/**
 * Lightweight mid-call appointment intent tracker for the voice-server.
 * Real booking always happens via Next.js bookAppointment (server-side).
 *
 * State machine:
 * NONE → MEETING_INTENT → COLLECT_DATE → COLLECT_TIME → CONFIRM_TIME → BOOKING → BOOKED → GOODBYE
 * MEETING_INTENT → DECLINED → GOODBYE
 */

import { isClearAppointmentConfirmation } from "./end-call-intent.js";

export type VoiceApptStatus =
  | "none"
  | "meeting_intent"
  | "collect_date"
  | "collect_time"
  | "proposed"
  | "awaiting_confirmation"
  | "confirmed"
  | "booked"
  | "failed"
  | "declined";

const CLOCK_RE = /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const DAY_RE =
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TZ_RE =
  /\b(ist|india(?:n)?\s+standard\s+time|india(?:n)?\s+time\s+standard|india\s+time|pkt|pst|pdt|est|edt|utc|gmt)\b/i;
const VAGUE_ONLY_RE = /\b(morning|afternoon|evening|night)\b/i;
const MEETING_INTENT_RE =
  /\b(schedule|meeting|appointment|book(?:ing)?|calendar|set\s+up\s+a\s+(?:call|meeting)|talk\s+to\s+(?:your\s+)?(?:team|members)|speak\s+(?:to|with)\s+(?:your\s+)?(?:team|members))\b/i;
const DECLINED_RE =
  /\b(not\s+interested|no\s+(?:thanks|thank\s+you)|don'?t\s+want\s+(?:a\s+)?(?:meeting|call|appointment)|maybe\s+later|no\s+meeting)\b/i;

export class AppointmentIntentTracker {
  private leadLines: string[] = [];
  private status: VoiceApptStatus = "none";
  private bookingAttempted = false;
  private lastPreferred = "";
  private meetingDate: string | null = null;
  private meetingTime: string | null = null;

  get appointmentStatus() {
    return this.status;
  }

  get preferredText() {
    return this.lastPreferred;
  }

  get hasBooked() {
    return this.status === "booked";
  }

  get hasAttemptedBooking() {
    return this.bookingAttempted;
  }

  get dateHint() {
    return this.meetingDate;
  }

  get timeHint() {
    return this.meetingTime;
  }

  /** True while date/time/confirm still needed — do not hang up. */
  get isFlowActive() {
    return (
      this.status === "meeting_intent" ||
      this.status === "collect_date" ||
      this.status === "collect_time" ||
      this.status === "proposed" ||
      this.status === "awaiting_confirmation" ||
      this.status === "confirmed"
    );
  }

  noteLead(text: string) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned === "[unclear]") return;
    if (this.leadLines[this.leadLines.length - 1] === cleaned) {
      this.lastPreferred = this.buildPreferredPhrase();
      return;
    }
    this.leadLines.push(cleaned);
    this.lastPreferred = this.buildPreferredPhrase();
    if (this.status === "booked" || this.status === "failed") return;

    if (DECLINED_RE.test(cleaned)) {
      this.status = "declined";
      return;
    }

    const dayM = cleaned.match(DAY_RE);
    const timeM = cleaned.match(CLOCK_RE);
    if (dayM) this.meetingDate = dayM[0];
    if (timeM) this.meetingTime = timeM[0];

    if (MEETING_INTENT_RE.test(cleaned) && this.status === "none") {
      this.status = "meeting_intent";
    }

    this.refreshCollectionStage();
  }

  noteAgent(text: string) {
    if (/\b(confirm|works for you|does that work|is that right)\b/i.test(text)) {
      if (this.hasBookablePhrase() && !this.isAmbiguousOnly()) {
        this.status = "awaiting_confirmation";
      }
    }
  }

  /**
   * Coaching text injected into Gemini when the model must not skip states.
   */
  coachingHint(): string | null {
    switch (this.status) {
      case "meeting_intent":
      case "collect_date":
        return "[INTERNAL] appt=need_date. Ask only for best day. Do not goodbye. Do not claim booking.";
      case "collect_time":
        return `[INTERNAL] appt=need_time date=${this.meetingDate || "?"}. Ask only for clock time. Do not claim booking.`;
      case "proposed":
      case "awaiting_confirmation":
        return `[INTERNAL] appt=confirm "${this.lastPreferred || "time"}". Do not hang up.`;
      case "confirmed":
        return "[INTERNAL] appt=awaiting_booking_result. Do not claim booked yet.";
      default:
        return null;
    }
  }

  /**
   * True when lead just confirmed a previously proposed concrete time.
   */
  shouldAttemptBooking(latestLead: string): boolean {
    if (this.bookingAttempted || this.status === "booked") return false;
    if (!this.hasBookablePhrase() || this.isAmbiguousOnly()) return false;
    if (!isClearAppointmentConfirmation(latestLead)) return false;
    const prior = this.leadLines.slice(0, -1);
    const hadProposal = prior.some(
      (l) => CLOCK_RE.test(l) || (DAY_RE.test(l) && CLOCK_RE.test(this.lastPreferred))
    );
    const selfConfirm =
      CLOCK_RE.test(latestLead) && isClearAppointmentConfirmation(latestLead);
    if (!hadProposal && !selfConfirm) {
      if (
        this.status !== "proposed" &&
        this.status !== "awaiting_confirmation"
      ) {
        return false;
      }
    }
    this.status = "confirmed";
    this.bookingAttempted = true;
    return true;
  }

  markBookingAttempted() {
    this.bookingAttempted = true;
  }

  markBooked() {
    this.status = "booked";
    this.bookingAttempted = true;
  }

  markFailed() {
    this.status = "failed";
    this.bookingAttempted = true;
  }

  private refreshCollectionStage() {
    if (
      this.status === "booked" ||
      this.status === "failed" ||
      this.status === "declined" ||
      this.status === "confirmed" ||
      this.status === "awaiting_confirmation"
    ) {
      return;
    }

    if (MEETING_INTENT_RE.test(this.leadLines.join(" ")) || this.status !== "none") {
      if (!this.meetingDate) {
        this.status =
          this.status === "none" ? "meeting_intent" : "collect_date";
        if (this.status === "meeting_intent") this.status = "collect_date";
      } else if (!this.meetingTime) {
        this.status = "collect_time";
      } else if (this.hasBookablePhrase() && !this.isAmbiguousOnly()) {
        this.status = "proposed";
      }
    }
  }

  private hasBookablePhrase(): boolean {
    const phrase = this.lastPreferred;
    return Boolean(phrase && CLOCK_RE.test(phrase) && DAY_RE.test(phrase));
  }

  private isAmbiguousOnly(): boolean {
    const phrase = this.lastPreferred;
    if (!phrase) return true;
    if (CLOCK_RE.test(phrase)) return false;
    return VAGUE_ONLY_RE.test(phrase) && !CLOCK_RE.test(phrase);
  }

  private buildPreferredPhrase(): string {
    const dayHints: string[] = [];
    const timeHints: string[] = [];
    const tzHints: string[] = [];
    for (const line of this.leadLines) {
      if (DAY_RE.test(line)) dayHints.push(line);
      if (CLOCK_RE.test(line)) timeHints.push(line);
      if (TZ_RE.test(line)) tzHints.push(line);
    }
    const parts = [
      dayHints[dayHints.length - 1] || "",
      timeHints[timeHints.length - 1] || "",
      tzHints[tzHints.length - 1] || "",
    ].filter(Boolean);
    return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
  }
}
