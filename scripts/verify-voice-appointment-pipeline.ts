/**
 * Voice → appointment pipeline verification (parser, intent, wiring).
 * Run: npx tsx scripts/verify-voice-appointment-pipeline.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { parsePreferredMeetingTime } from "../src/lib/calendar/parse-meeting-time";
import {
  buildPreferredPhraseFromTranscript,
  resolveAppointmentIntent,
  transcriptHasConfirmation,
} from "../src/lib/calendar/appointment-intent";
import { zonedLocalToUtc, getZonedParts } from "../src/lib/calendar/timezone";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

const now = new Date("2026-09-06T10:00:00Z"); // Sat

// A. Explicit time + timezone IST → Asia/Kolkata
{
  const parsed = parsePreferredMeetingTime({
    text: "Tomorrow at 4 PM IST",
    timezone: "UTC",
    now,
  });
  assert(!!parsed && !parsed.ambiguous, "A: parse tomorrow 4pm IST");
  assert(parsed!.timezone === "Asia/Kolkata", "A: timezone Asia/Kolkata");
  const parts = getZonedParts(parsed!.start, "Asia/Kolkata");
  assert(parts.hour === 16 && parts.minute === 0, "A: 16:00 local");
  assert(parts.day === 7 && parts.month === 9, "A: tomorrow Sep 7");
}

// B. Explicit time overrides vague afternoon
{
  const phrase = buildPreferredPhraseFromTranscript([
    { speaker: "LEAD", text: "Thing we can set up like tomorrow." },
    { speaker: "LEAD", text: "At 4:00 p.m." },
    { speaker: "LEAD", text: "IST" },
    { speaker: "LEAD", text: "IST afternoon" },
  ]);
  assert(/4:00\s*p\.?m\.?/i.test(phrase), "B: keeps 4pm");
  assert(/\bist\b/i.test(phrase), "B: keeps IST");
  const parsed = parsePreferredMeetingTime({
    text: phrase,
    timezone: "America/Los_Angeles",
    now,
  });
  assert(!!parsed && !parsed.ambiguous, "B: not ambiguous");
  assert(parsed!.timezone === "Asia/Kolkata", "B: IST wins over company Pacific");
  const parts = getZonedParts(parsed!.start, "Asia/Kolkata");
  assert(parts.hour === 16, "B: 16:00 Kolkata");
}

// C. Confirmation → booking attempt eligible
{
  const transcripts = [
    { speaker: "LEAD", text: "Tomorrow at 4 PM IST" },
    { speaker: "AI", text: "Just to confirm, tomorrow at 4 PM IST works for you?" },
    { speaker: "LEAD", text: "Yes." },
  ];
  assert(transcriptHasConfirmation(transcripts), "C: yes confirms");
  const intent = resolveAppointmentIntent({
    transcripts,
    companyTimezone: "UTC",
    now,
  });
  assert(intent.confirmed, "C: intent confirmed");
  assert(!intent.ambiguous, "C: not ambiguous");
  assert(intent.status === "confirmed", "C: status confirmed");
  assert(intent.timezone === "Asia/Kolkata", "C: IST timezone");
}

// F. Ambiguous tomorrow afternoon → no bookable parse
{
  const intent = resolveAppointmentIntent({
    transcripts: [
      { speaker: "LEAD", text: "Tomorrow afternoon" },
      { speaker: "LEAD", text: "Yes" },
    ],
    companyTimezone: "Asia/Kolkata",
    now,
  });
  assert(intent.ambiguous || !intent.parsed || intent.parsed.ambiguous, "F: ambiguous");
  assert(intent.status !== "confirmed" || intent.ambiguous, "F: not confirmed bookable");
}

// H. No timezone hallucination — company Pacific must not override IST
{
  const parsed = parsePreferredMeetingTime({
    text: "tomorrow at 4 PM IST",
    timezone: "America/Los_Angeles",
    now,
  });
  assert(parsed!.timezone === "Asia/Kolkata", "H: never Pacific when IST said");
  assert(parsed!.timezone !== "America/Los_Angeles", "H: not LA");
}

// Early "okay" before proposal must not confirm
{
  const transcripts = [
    { speaker: "LEAD", text: "Okay" },
    { speaker: "LEAD", text: "Tomorrow at 4 PM IST" },
  ];
  assert(!transcriptHasConfirmation(transcripts), "no early okay confirm");
}

// Source wiring
const root = process.cwd();
const voiceCalls = readFileSync(path.join(root, "src/services/voice-calls.ts"), "utf8");
assert(
  voiceCalls.includes("attemptBookAppointmentFromCall"),
  "finalize uses shared voice booking"
);
assert(
  !voiceCalls.includes("From AI call summary. Preferred:"),
  "no summary-only direct book path"
);

const bookingSvc = readFileSync(
  path.join(root, "src/services/voice-appointment-booking.ts"),
  "utf8"
);
assert(bookingSvc.includes('idempotencyKey: `call:${call.id}`'), "idempotency call key");
assert(bookingSvc.includes("bookAppointment"), "uses bookAppointment");
assert(bookingSvc.includes("[voice:appointment]"), "server logs");

const fromCall = readFileSync(
  path.join(root, "src/app/api/voice/appointments/from-call/route.ts"),
  "utf8"
);
assert(fromCall.includes("attemptBookAppointmentFromCall"), "from-call shared service");
assert(fromCall.includes("streamToken"), "stream auth");

const finalizeRoute = readFileSync(
  path.join(root, "src/app/api/voice/appointments/finalize/route.ts"),
  "utf8"
);
assert(finalizeRoute.includes("finalizeCallForAppointments"), "finalize route");

const replay = readFileSync(
  path.join(root, "src/app/api/voice/appointments/replay-finalize/route.ts"),
  "utf8"
);
assert(replay.includes("replayAllowed"), "dev replay guard");

const prompts = readFileSync(
  path.join(root, "voice-server/src/prompts.ts"),
  "utf8"
);
assert(prompts.includes("Never invent a timezone"), "prompt no invent tz");
assert(prompts.includes("SYSTEM booking success"), "prompt system gate");

const streamHandler = readFileSync(
  path.join(root, "voice-server/src/twilio-stream-handler.ts"),
  "utf8"
);
assert(streamHandler.includes("bookAppointmentFromVoiceCall"), "mid-call book");
assert(streamHandler.includes("finalizeVoiceAppointment"), "hangup finalize");
assert(streamHandler.includes("completeTwilioCall"), "hangup preserved");

const manual = readFileSync(
  path.join(root, "src/app/api/appointments/route.ts"),
  "utf8"
);
assert(manual.includes("bookAppointment"), "I: manual booking route intact");

// Sanity: expected UTC for Sep 7 16:00 Asia/Kolkata
{
  const utc = zonedLocalToUtc({
    year: 2026,
    month: 9,
    day: 7,
    hour: 16,
    minute: 0,
    timezone: "Asia/Kolkata",
  });
  // IST = UTC+5:30 → 10:30 UTC
  assert(utc.toISOString() === "2026-09-07T10:30:00.000Z", "kolkata→utc");
}

console.log("Voice appointment pipeline verification passed.");
