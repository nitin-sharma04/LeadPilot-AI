/**
 * Lightweight mid-call appointment intent tracker for the voice-server.
 * Real booking always happens via Next.js bookAppointment (server-side).
 */

import { isClearAppointmentConfirmation } from "./end-call-intent.js";

export type VoiceApptStatus =
  | "none"
  | "proposed"
  | "awaiting_confirmation"
  | "confirmed"
  | "booked"
  | "failed";

const CLOCK_RE = /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const DAY_RE =
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TZ_RE =
  /\b(ist|india(?:n)?\s+standard\s+time|india(?:n)?\s+time\s+standard|india\s+time|pkt|pst|pdt|est|edt|utc|gmt)\b/i;
const VAGUE_ONLY_RE = /\b(morning|afternoon|evening|night)\b/i;

export class AppointmentIntentTracker {
  private leadLines: string[] = [];
  private status: VoiceApptStatus = "none";
  private bookingAttempted = false;
  private lastPreferred = "";

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

    if (this.hasBookablePhrase() && !this.isAmbiguousOnly()) {
      this.status =
        this.status === "awaiting_confirmation" || this.status === "confirmed"
          ? this.status
          : "proposed";
    }
  }

  noteAgent(text: string) {
    if (/\b(confirm|works for you|does that work)\b/i.test(text)) {
      if (this.hasBookablePhrase() && !this.isAmbiguousOnly()) {
        this.status = "awaiting_confirmation";
      }
    }
  }

  /**
   * True when lead just confirmed a previously proposed concrete time.
   */
  shouldAttemptBooking(latestLead: string): boolean {
    if (this.bookingAttempted || this.status === "booked") return false;
    if (!this.hasBookablePhrase() || this.isAmbiguousOnly()) return false;
    if (!isClearAppointmentConfirmation(latestLead)) return false;
    // Require confirmation after we already have a schedule phrase in prior lines,
    // OR a self-confirming schedule line.
    const prior = this.leadLines.slice(0, -1);
    const hadProposal = prior.some(
      (l) => CLOCK_RE.test(l) || (DAY_RE.test(l) && CLOCK_RE.test(this.lastPreferred))
    );
    const selfConfirm =
      CLOCK_RE.test(latestLead) && isClearAppointmentConfirmation(latestLead);
    if (!hadProposal && !selfConfirm) {
      // Allow when we already have a proposed / awaiting_confirmation state.
      if (
        this.status !== "proposed" &&
        this.status !== "awaiting_confirmation"
      ) {
        return false;
      }
    }
    this.status = "confirmed";
    // Claim the booking attempt atomically to prevent double POSTs.
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
