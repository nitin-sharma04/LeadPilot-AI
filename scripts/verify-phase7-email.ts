/**
 * Phase 7 email / follow-up verification (wiring + security invariants).
 * Run: npx tsx scripts/verify-phase7-email.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { aiEmailResultSchema } from "../src/lib/ai/email-generator";
import { EMAIL_SYSTEM_PROMPT } from "../src/lib/ai/prompts/email";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

const root = process.cwd();

// A/D AI schema
assert(
  aiEmailResultSchema.safeParse({
    subject: "Quick question",
    body: "Hello there, sharing a short note about your website booking needs.",
    callToAction: "Are you free Thursday?",
  }).success,
  "D: valid AI email"
);
assert(
  !aiEmailResultSchema.safeParse({ subject: "x", body: "short", callToAction: "" })
    .success,
  "E: invalid AI email rejected"
);
assert(EMAIL_SYSTEM_PROMPT.includes("Never invent"), "prompt safety");

// Wiring
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
assert(schema.includes("model EmailAccount"), "EmailAccount model");
assert(schema.includes("model EmailMessage"), "EmailMessage model");
assert(schema.includes("model FollowUpSequence"), "FollowUpSequence model");
assert(schema.includes("model FollowUpEnrollment"), "FollowUpEnrollment model");
assert(schema.includes("emailOptOut"), "lead opt-out");
assert(schema.includes("emailHumanApprovalRequired"), "human approval setting");

const gmailCfg = readFileSync(
  path.join(root, "src/lib/email/gmail-config.ts"),
  "utf8"
);
assert(gmailCfg.includes("gmail.send"), "gmail send scope");
assert(gmailCfg.includes("gmail.readonly"), "gmail readonly scope");

const sendSvc = readFileSync(path.join(root, "src/services/email.ts"), "utf8");
assert(sendSvc.includes("idempotencyKey"), "H: idempotency");
assert(sendSvc.includes("EMAIL_SENT"), "activity sent");
assert(sendSvc.includes("EMAIL_FAILED"), "activity failed");
assert(sendSvc.includes("sendGmailMessage"), "uses gmail client");

const scheduler = readFileSync(
  path.join(root, "src/services/follow-up-sequences.ts"),
  "utf8"
);
assert(scheduler.includes("processingLock"), "I: locking");
assert(scheduler.includes("enroll:"), "step idempotency key");

const replies = readFileSync(
  path.join(root, "src/services/gmail-reply-sync.ts"),
  "utf8"
);
assert(replies.includes("REPLIED"), "J: stop on reply");
assert(replies.includes("UNSUBSCRIBED") || replies.includes("OPTED_OUT"), "K: opt-out");

const automation = readFileSync(
  path.join(root, "src/services/email-automation.ts"),
  "utf8"
);
assert(automation.includes("appointmentBooked"), "M: booked guard");
assert(automation.includes("emailHumanApprovalRequired"), "N: approval");

const cron = readFileSync(
  path.join(root, "src/app/api/cron/email-followups/route.ts"),
  "utf8"
);
assert(cron.includes("CRON_SECRET"), "cron auth");

const appt = readFileSync(
  path.join(root, "src/services/appointments.ts"),
  "utf8"
);
assert(appt.includes("bookAppointment"), "P: manual book intact");
assert(appt.includes("maybeSendAppointmentConfirmation"), "L: appt hook");

const voice = readFileSync(
  path.join(root, "src/services/voice-calls.ts"),
  "utf8"
);
assert(voice.includes("maybeSendPostCallEmail"), "post-call hook");
assert(voice.includes("attemptBookAppointmentFromCall"), "Q: voice booking intact");

const env = readFileSync(path.join(root, ".env.example"), "utf8");
assert(env.includes("GOOGLE_GMAIL_REDIRECT_URI"), "env gmail redirect");
assert(env.includes("CRON_SECRET"), "env cron");

console.log("Phase 7 email / follow-up verification passed.");
