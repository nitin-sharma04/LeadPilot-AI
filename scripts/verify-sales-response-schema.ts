/**
 * Offline Zod checks for Phase 4 sales response schema.
 * Run: npx tsx scripts/verify-sales-response-schema.ts
 */
import { salesResponseResultSchema } from "../src/types/sales-response";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const emailOk = salesResponseResultSchema.safeParse({
  channel: "email",
  subject: "Quick idea for Apex Dental's website refresh",
  body: "Hi Sarah — noticed you're evaluating a redesign...",
  callToAction: "Would a 15-minute call this week help?",
  personalizationNotes: ["Website redesign", "High urgency"],
});
assert(emailOk.success, "Valid email response should pass");

const messageOk = salesResponseResultSchema.safeParse({
  channel: "message",
  subject: null,
  body: "Hi Sarah — quick thought on your booking flow.",
  callToAction: "Open to a short chat?",
});
assert(messageOk.success, "Valid message response should pass");

const emailMissingSubject = salesResponseResultSchema.safeParse({
  channel: "email",
  subject: null,
  body: "Hello",
  callToAction: "Call me",
  personalizationNotes: [],
});
assert(!emailMissingSubject.success, "Email without subject should fail");

const malformed = salesResponseResultSchema.safeParse({
  channel: "fax",
  body: "",
});
assert(!malformed.success, "Malformed payload should fail");

console.log("Sales response schema verification passed.");
