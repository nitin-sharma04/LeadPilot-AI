/**
 * Timezone helpers for appointment scheduling.
 * Timestamps are stored as UTC Instant (Prisma DateTime); timezone is IANA metadata.
 */

const IANA_TZ =
  /^(UTC|[A-Za-z]+\/[A-Za-z0-9_\-+]+|[A-Za-z]+\/[A-Za-z0-9_\-+]+\/[A-Za-z0-9_\-+]+)$/;

export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || !IANA_TZ.test(tz)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertTimezone(tz: string): string {
  const value = tz.trim() || "UTC";
  if (!isValidIanaTimezone(value)) {
    throw new Error(`Invalid timezone: ${tz}`);
  }
  return value;
}

/** Build a UTC Date from local wall-clock parts in an IANA timezone. */
export function zonedLocalToUtc(input: {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}): Date {
  const tz = assertTimezone(input.timezone);
  const utcGuess = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    0
  );

  // Iteratively correct using the timezone offset at the guessed instant.
  let instant = utcGuess;
  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(new Date(instant), tz);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0
    );
    const desired = Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      input.hour,
      input.minute,
      0
    );
    instant += desired - asUtc;
  }
  return new Date(instant);
}

export function getZonedParts(date: Date, timezone: string) {
  const tz = assertTimezone(timezone);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value || "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function formatInTimezone(
  date: Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const tz = assertTimezone(timezone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

/**
 * Local wall-clock RFC3339 WITHOUT offset/Z for Google Calendar events.
 * Pair with timeZone: IANA. Never append "Z" to a local IST wall clock.
 */
export function formatRfc3339Local(date: Date, timezone: string): string {
  const p = getZonedParts(date, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
