/**
 * Parse natural / preferred meeting time phrases into a concrete start Date.
 * Returns null when ambiguous (e.g. "Tuesday morning" without a clock time).
 *
 * Explicit numeric times (e.g. 4 PM) win over vague periods (afternoon).
 * Timezone aliases in the text (IST → Asia/Kolkata) override the fallback.
 *
 * CRITICAL: wall-clock hour/minute are ALWAYS interpreted in `timezone`,
 * never as UTC. Conversion to a UTC Instant uses zonedLocalToUtc only.
 */

import {
  zonedLocalToUtc,
  assertTimezone,
  isValidIanaTimezone,
  getZonedParts,
} from "./timezone";
import { resolveTimezoneAlias } from "./timezone-aliases";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export type ParsedMeetingTime = {
  start: Date;
  timezone: string;
  /** Local wall-clock parts in `timezone` (not UTC). */
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  };
  confidence: "high" | "medium" | "low";
  ambiguous: boolean;
  raw: string;
};

function resolveTimezoneFromText(text: string, fallback: string): string {
  const aliased = resolveTimezoneAlias(text);
  if (aliased) return aliased;
  if (isValidIanaTimezone(fallback)) return fallback;
  return "UTC";
}

/**
 * Strip vague day-parts when an explicit clock time is present so
 * "4 PM IST afternoon" does not become ambiguous.
 */
function normalizePhrase(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  const hasClock = /\b\d{1,2}(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(text);
  if (hasClock) {
    text = text
      .replace(/\b(morning|afternoon|evening|night)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return text;
}

function ambiguousResult(
  now: Date,
  timezone: string,
  raw: string
): ParsedMeetingTime {
  const parts = getZonedParts(now, timezone);
  return {
    start: now,
    timezone,
    local: parts,
    confidence: "low",
    ambiguous: true,
    raw,
  };
}

export function parsePreferredMeetingTime(input: {
  text: string;
  timezone: string;
  now?: Date;
}): ParsedMeetingTime | null {
  const raw = normalizePhrase(input.text);
  if (!raw) return null;

  const timezone = resolveTimezoneFromText(raw, input.timezone);
  try {
    assertTimezone(timezone);
  } catch {
    return null;
  }

  const now = input.now ?? new Date();

  // Explicit ISO calendar date — still interpret wall clock via timezone when no Z.
  // If the string includes Z/offset, Date.parse is an absolute instant.
  if (/\d{4}-\d{2}-\d{2}/.test(raw)) {
    const hasOffset = /[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(raw.trim());
    if (hasOffset) {
      const iso = Date.parse(raw);
      if (!Number.isNaN(iso)) {
        const start = new Date(iso);
        return {
          start,
          timezone,
          local: getZonedParts(start, timezone),
          confidence: "high",
          ambiguous: false,
          raw,
        };
      }
    } else {
      // timezone-less ISO local: YYYY-MM-DDTHH:mm — treat as wall clock in target TZ
      const m = raw.match(
        /(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/
      );
      if (m) {
        const local = {
          year: Number(m[1]),
          month: Number(m[2]),
          day: Number(m[3]),
          hour: Number(m[4] || "0"),
          minute: Number(m[5] || "0"),
        };
        const start = zonedLocalToUtc({ ...local, timezone });
        return {
          start,
          timezone,
          local,
          confidence: "high",
          ambiguous: false,
          raw,
        };
      }
    }
  }

  const lower = raw.toLowerCase();

  // Ambiguous period WITHOUT any clock digits
  if (
    /\b(morning|afternoon|evening|night)\b/.test(lower) &&
    !/\d/.test(lower)
  ) {
    return ambiguousResult(now, timezone, raw);
  }

  const timeMatch = lower.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/
  );
  if (!timeMatch) {
    return ambiguousResult(now, timezone, raw);
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || "0");
  const meridiem = (timeMatch[3] || "").replace(/\./g, "");

  if (meridiem.startsWith("p") && hour < 12) hour += 12;
  if (meridiem.startsWith("a") && hour === 12) hour = 0;
  if (!meridiem) {
    // 24h style 13-23 ok; 1-7 without am/pm ambiguous; 8-12 treat as that hour
    if (hour >= 1 && hour <= 7) {
      return ambiguousResult(now, timezone, raw);
    }
  }

  let dayParts = zonedParts(now, timezone);
  const weekdayName = Object.keys(WEEKDAYS).find((d) =>
    new RegExp(`\\b${d}\\b`).test(lower)
  );

  if (/\btoday\b/.test(lower)) {
    // keep dayParts
  } else if (/\btomorrow\b/.test(lower)) {
    const d = new Date(
      Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day + 1)
    );
    dayParts = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  } else if (weekdayName) {
    const want = WEEKDAYS[weekdayName];
    const currentDow = new Date(
      Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day)
    ).getUTCDay();
    let delta = (want - currentDow + 7) % 7;
    if (delta === 0) delta = 7;
    const d = new Date(
      Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day + delta)
    );
    dayParts = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  } else if (!/\d{4}-\d{2}-\d{2}/.test(raw)) {
    return ambiguousResult(now, timezone, raw);
  }

  const local = {
    year: dayParts.year,
    month: dayParts.month,
    day: dayParts.day,
    hour,
    minute,
  };

  const start = zonedLocalToUtc({
    ...local,
    timezone,
  });

  console.info("[calendar:parse] meeting time", {
    raw,
    localDate: `${local.year}-${local.month}-${local.day}`,
    localTime: `${local.hour}:${String(local.minute).padStart(2, "0")}`,
    timezone,
    utcIso: start.toISOString(),
  });

  return {
    start,
    timezone,
    local,
    confidence:
      weekdayName || /\btomorrow\b|\btoday\b/.test(lower) ? "high" : "medium",
    ambiguous: false,
    raw,
  };
}

function zonedParts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value || "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}
