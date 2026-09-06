/**
 * Timezone / Google Calendar datetime regression tests.
 * Run: npx tsx scripts/verify-timezone-google.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { parsePreferredMeetingTime } from "../src/lib/calendar/parse-meeting-time";
import { extractTimezoneFromText } from "../src/lib/calendar/appointment-intent";
import {
  formatRfc3339Local,
  getZonedParts,
  zonedLocalToUtc,
  addMinutes,
} from "../src/lib/calendar/timezone";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

const now = new Date("2026-09-07T10:00:00Z");

function expectWall(
  text: string,
  hour: number,
  minute: number,
  label: string
) {
  const parsed = parsePreferredMeetingTime({
    text,
    timezone: "UTC", // must NOT win over IST in text
    now,
  });
  assert(!!parsed && !parsed.ambiguous, `${label}: parseable`);
  assert(parsed!.timezone === "Asia/Kolkata", `${label}: Asia/Kolkata`);
  assert(parsed!.local.hour === hour, `${label}: local hour ${hour}`);
  assert(parsed!.local.minute === minute, `${label}: local minute`);
  const wall = getZonedParts(parsed!.start, "Asia/Kolkata");
  assert(wall.hour === hour && wall.minute === minute, `${label}: wall clock`);
  const googleStart = formatRfc3339Local(parsed!.start, parsed!.timezone);
  assert(
    googleStart.endsWith(
      `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`
    ),
    `${label}: Google local ${googleStart}`
  );
  assert(!googleStart.endsWith("Z"), `${label}: no Z on Google local`);
  return parsed!;
}

// TEST 1: 8 PM IST
{
  const p = expectWall("Tomorrow at 8 PM IST", 20, 0, "T1");
  assert(p.start.toISOString() === "2026-09-08T14:30:00.000Z", "T1: 14:30 UTC");
}

// Real bug phrase
{
  const p = expectWall(
    "tomorrow at 8:00 p.m. for Indian time standard",
    20,
    0,
    "T1b Indian time standard"
  );
  assert(p.start.toISOString() === "2026-09-08T14:30:00.000Z", "T1b utc");
  assert(
    extractTimezoneFromText("Indian time standard", "UTC") === "Asia/Kolkata",
    "T1b alias"
  );
}

// TEST 2: 4 PM IST
expectWall("Tomorrow at 4 PM IST", 16, 0, "T2");

// TEST 3: 10 AM IST
expectWall("Tomorrow at 10 AM IST", 10, 0, "T3");

// TEST 4: afternoon + explicit time
expectWall("Tomorrow afternoon, 4 PM, IST", 16, 0, "T4");

// TEST 5: mathematical UTC conversion
{
  const utc = zonedLocalToUtc({
    year: 2026,
    month: 9,
    day: 8,
    hour: 20,
    minute: 0,
    timezone: "Asia/Kolkata",
  });
  assert(utc.toISOString() === "2026-09-08T14:30:00.000Z", "T5: 20:00 IST = 14:30Z");
}

// TEST 6: no timezone → company/fallback (not forced UTC invent)
{
  const parsed = parsePreferredMeetingTime({
    text: "Tomorrow at 3 PM",
    timezone: "America/New_York",
    now,
  });
  assert(parsed!.timezone === "America/New_York", "T6: company/default tz");
  assert(parsed!.local.hour === 15, "T6: 3 PM local");
}

// Wrong path must never happen: 20:00Z as IST wall
{
  const wrong = getZonedParts(new Date("2026-09-08T20:00:00.000Z"), "Asia/Kolkata");
  assert(wrong.hour === 1 && wrong.minute === 30, "documents 2AM bug pattern");
}

// Google end = start + 30m in same local zone
{
  const start = zonedLocalToUtc({
    year: 2026,
    month: 9,
    day: 8,
    hour: 20,
    minute: 0,
    timezone: "Asia/Kolkata",
  });
  const end = addMinutes(start, 30);
  assert(
    formatRfc3339Local(start, "Asia/Kolkata") === "2026-09-08T20:00:00",
    "Google start local"
  );
  assert(
    formatRfc3339Local(end, "Asia/Kolkata") === "2026-09-08T20:30:00",
    "Google end local"
  );
}

// Wiring: Google create must not use toISOString for event start
const googleSrc = readFileSync(
  path.join(process.cwd(), "src/lib/calendar/google-calendar.ts"),
  "utf8"
);
assert(googleSrc.includes("formatRfc3339Local"), "uses local formatter");
assert(
  !/start:\s*\{\s*dateTime:\s*input\.event\.start\.toISOString\(\)/.test(googleSrc),
  "no toISOString for event start"
);

const manual = readFileSync(
  path.join(process.cwd(), "src/app/api/appointments/route.ts"),
  "utf8"
);
assert(manual.includes("bookAppointment"), "T7 manual route intact");

console.log("Timezone / Google Calendar verification passed.");
