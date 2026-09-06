import {
  parsePreferredMeetingTime,
} from "../src/lib/calendar/parse-meeting-time";
import {
  extractTimezoneFromText,
} from "../src/lib/calendar/appointment-intent";
import {
  formatRfc3339Local,
  getZonedParts,
  zonedLocalToUtc,
} from "../src/lib/calendar/timezone";

const now = new Date("2026-09-07T10:00:00Z");

function trace(label: string, text: string, fallback = "UTC") {
  const detectedTz = extractTimezoneFromText(text, fallback);
  const parsed = parsePreferredMeetingTime({
    text,
    timezone: fallback,
    now,
  });
  console.log("\n===", label, "===");
  console.log("raw:", text);
  console.log("detectedTz:", detectedTz);
  if (!parsed) {
    console.log("parsed: null");
    return;
  }
  console.log("ambiguous:", parsed.ambiguous);
  console.log("timezone:", parsed.timezone);
  console.log("local:", parsed.local);
  console.log("iso (UTC instant):", parsed.start.toISOString());
  console.log("wall Asia/Kolkata:", getZonedParts(parsed.start, "Asia/Kolkata"));
  console.log("OLD (buggy) Google payload:", {
    dateTime: parsed.start.toISOString(),
    timeZone: parsed.timezone,
  });
  console.log("NEW Google payload:", {
    dateTime: formatRfc3339Local(parsed.start, parsed.timezone),
    timeZone: parsed.timezone,
  });
}

trace("A lead phrase", "tomorrow at 8:00 p.m. for Indian time standard");
trace("B IST abbr", "Tomorrow at 8 PM IST");
trace("C Indian Standard Time", "Tomorrow at 8 PM Indian Standard Time");

const correct = zonedLocalToUtc({
  year: 2026,
  month: 9,
  day: 8,
  hour: 20,
  minute: 0,
  timezone: "Asia/Kolkata",
});
console.log("\n=== reference ===");
console.log("20:00 Asia/Kolkata =>", correct.toISOString(), "(expect 14:30Z)");
console.log(
  "20:00Z shown in Kolkata =>",
  getZonedParts(new Date("2026-09-08T20:00:00.000Z"), "Asia/Kolkata"),
  "(the ~2 AM bug)"
);
