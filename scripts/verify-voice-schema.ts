/**
 * Offline Phase 5 voice schema checks.
 * Run: npx tsx scripts/verify-voice-schema.ts
 */
import {
  callSummaryResultSchema,
  initiateVoiceCallRequestSchema,
  voiceTurnResultSchema,
} from "../src/types/voice";
import { normalizePhone } from "../src/services/voice-calls";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(normalizePhone("+15551234567") === "+15551234567", "E.164 should pass");
assert(normalizePhone("5551234567") === "+15551234567", "10-digit US should normalize");
assert(normalizePhone("abc") === null, "invalid phone should fail");

const turn = voiceTurnResultSchema.safeParse({
  reply: "Thanks for your time. Are you evaluating solutions this quarter?",
  endCall: false,
  handoffRequested: false,
  appointmentRequested: false,
  optOut: false,
});
assert(turn.success, "valid voice turn should pass");

const summary = callSummaryResultSchema.safeParse({
  summary: "Lead confirmed interest and asked for a follow-up.",
  outcome: "callback_requested",
  interestLevel: "medium",
  keyRequirements: ["Website redesign"],
  painPoints: ["Missed calls"],
  objections: [],
  nextAction: "Schedule a callback tomorrow.",
  followUpRecommended: true,
});
assert(summary.success, "valid call summary should pass");

const badReq = initiateVoiceCallRequestSchema.safeParse({ leadId: "nope" });
assert(!badReq.success, "invalid leadId should fail");

console.log("Voice schema verification passed.");
