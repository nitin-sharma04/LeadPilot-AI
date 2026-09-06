/**
 * Phase 6 appointment booking verification (no live Google OAuth required).
 * Run: npx tsx scripts/verify-appointments.ts
 */
import { readFileSync } from "fs";
import path from "path";
import {
  assertTimezone,
  isValidIanaTimezone,
  rangesOverlap,
  zonedLocalToUtc,
  addMinutes,
} from "../src/lib/calendar/timezone";
import { parsePreferredMeetingTime } from "../src/lib/calendar/parse-meeting-time";
import { hasBusyConflict } from "../src/lib/calendar/google-calendar";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

// Timezone
assert(isValidIanaTimezone("Asia/Kolkata"), "kolkata tz");
assert(isValidIanaTimezone("America/Los_Angeles"), "la tz");
assert(!isValidIanaTimezone("Not/AZone"), "bad tz");
assert(assertTimezone("UTC") === "UTC", "utc");

const start = zonedLocalToUtc({
  year: 2026,
  month: 9,
  day: 15,
  hour: 14,
  minute: 0,
  timezone: "Asia/Kolkata",
});
assert(start instanceof Date && !Number.isNaN(start.getTime()), "zoned convert");

const a1 = new Date("2026-09-15T10:00:00Z");
const a2 = addMinutes(a1, 30);
const b1 = new Date("2026-09-15T10:15:00Z");
const b2 = addMinutes(b1, 30);
assert(rangesOverlap(a1, a2, b1, b2), "overlap");
assert(!rangesOverlap(a1, a2, addMinutes(a2, 1), addMinutes(a2, 31)), "no overlap");

// Parse meeting times
const now = new Date("2026-09-08T10:00:00Z");
const tue = parsePreferredMeetingTime({
  text: "Tuesday at 2 PM",
  timezone: "America/New_York",
  now,
});
assert(tue && !tue.ambiguous, "tuesday 2pm parsed");
assert(
  parsePreferredMeetingTime({
    text: "Tuesday morning",
    timezone: "UTC",
    now,
  })?.ambiguous === true,
  "tuesday morning ambiguous"
);
assert(
  parsePreferredMeetingTime({
    text: "around 2",
    timezone: "UTC",
    now,
  })?.ambiguous === true,
  "around 2 ambiguous"
);
assert(
  parsePreferredMeetingTime({
    text: "tomorrow at 8:00 p.m. for Indian time standard",
    timezone: "UTC",
    now,
  })?.timezone === "Asia/Kolkata",
  "Indian time standard → Kolkata"
);
{
  const eightPm = parsePreferredMeetingTime({
    text: "tomorrow at 8:00 p.m. for Indian time standard",
    timezone: "UTC",
    now,
  });
  assert(!!eightPm && !eightPm.ambiguous, "8 PM IST parseable");
  assert(eightPm!.local.hour === 20, "8 PM local hour");
  assert(
    eightPm!.start.toISOString() !== "2026-09-09T20:00:00.000Z",
    "8 PM IST must not be stored as 20:00Z"
  );
  // now is Sep 8 → tomorrow Sep 9 20:00 IST = 14:30Z
  assert(
    eightPm!.start.toISOString() === "2026-09-09T14:30:00.000Z",
    "8 PM IST → 14:30Z not 20:00Z"
  );
}

// Busy conflict helper
assert(
  hasBusyConflict(a1, a2, [{ start: b1, end: b2 }]),
  "google busy conflict"
);
assert(
  !hasBusyConflict(a1, a2, [
    { start: addMinutes(a2, 5), end: addMinutes(a2, 35) },
  ]),
  "no google conflict"
);

// Source wiring — never false-book without service
const voice = readFileSync(
  path.join(process.cwd(), "src/services/voice-calls.ts"),
  "utf8"
);
assert(voice.includes("attemptBookAppointmentFromCall"), "finalize can book");
assert(voice.includes("appointmentStatus"), "call summary appointment status");
assert(
  !voice.includes("const appointmentActuallyBooked = false;"),
  "no forced false booked"
);

const apptService = readFileSync(
  path.join(process.cwd(), "src/services/appointments.ts"),
  "utf8"
);
assert(apptService.includes("bookAppointment"), "book service");
assert(apptService.includes("409"), "conflict status");
assert(apptService.includes("idempotencyKey"), "idempotency");
assert(apptService.includes("APPOINTMENT_BOOKED"), "activity booked");
assert(apptService.includes("LeadPilot appointment"), "local label");

const googleCal = readFileSync(
  path.join(process.cwd(), "src/lib/calendar/google-calendar.ts"),
  "utf8"
);
assert(googleCal.includes("createCalendarEvent"), "create event");
assert(googleCal.includes("getCalendarAvailability"), "availability");
assert(googleCal.includes("freebusy"), "freebusy");

const oauth = readFileSync(
  path.join(process.cwd(), "src/lib/calendar/google-config.ts"),
  "utf8"
);
assert(oauth.includes("GOOGLE_CLIENT_ID"), "client id env");
assert(oauth.includes("GOOGLE_CALENDAR_DEMO") || oauth.includes("isGoogleCalendarDemoMode"), "demo mode");
assert(oauth.includes("GOOGLE_REDIRECT_URI") || oauth.includes("redirectUri"), "redirect");

const connect = readFileSync(
  path.join(process.cwd(), "src/app/api/integrations/google-calendar/connect/route.ts"),
  "utf8"
);
assert(connect.includes("requireSession"), "connect auth");
assert(connect.includes("isGoogleCalendarDemoMode"), "demo connect path");

const fromCall = readFileSync(
  path.join(process.cwd(), "src/app/api/voice/appointments/from-call/route.ts"),
  "utf8"
);
assert(fromCall.includes("explicitConfirmation"), "explicit confirm");
assert(fromCall.includes("attemptBookAppointmentFromCall"), "from-call uses shared booking");
assert(fromCall.includes("streamToken"), "stream token auth");

const voiceBooking = readFileSync(
  path.join(process.cwd(), "src/services/voice-appointment-booking.ts"),
  "utf8"
);
assert(voiceBooking.includes('idempotencyKey: `call:${call.id}`'), "voice booking idempotent");
assert(voiceBooking.includes("ambiguous_time"), "ambiguous guard");
assert(voiceBooking.includes("bookAppointment"), "voice booking calls service");

const schema = readFileSync(
  path.join(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);
assert(schema.includes("GoogleCalendarConnection"), "connection model");
assert(schema.includes("AppointmentSource"), "source enum");
assert(schema.includes("idempotencyKey"), "schema idempotency");
assert(schema.includes("appointmentStatus"), "summary status field");

const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
assert(envExample.includes("GOOGLE_CLIENT_ID"), "env google client");
assert(envExample.includes("GOOGLE_REDIRECT_URI"), "env redirect");

console.log("Appointment booking verification passed.");
