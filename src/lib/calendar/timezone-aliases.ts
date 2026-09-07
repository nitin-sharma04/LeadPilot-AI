/**
 * Shared IANA timezone aliases for voice / appointment parsing.
 * Never invent Pacific; IST variants → Asia/Kolkata.
 */

export const TIMEZONE_ALIASES: Array<{ re: RegExp; iana: string }> = [
  {
    re: /\b(ist|india(?:n)?\s+standard\s+time|india(?:n)?\s+time\s+standard|india(?:n)?\s+time)\b/i,
    iana: "Asia/Kolkata",
  },
  { re: /\b(pkt|pakistan\s+standard\s+time)\b/i, iana: "Asia/Karachi" },
  { re: /\b(bst|british\s+summer\s+time)\b/i, iana: "Europe/London" },
  { re: /\b(gmt|utc)\b/i, iana: "UTC" },
  {
    re: /\b(pst|pdt|pacific\s+standard\s+time|pacific\s+time)\b/i,
    iana: "America/Los_Angeles",
  },
  {
    re: /\b(est|edt|eastern\s+standard\s+time|eastern\s+time)\b/i,
    iana: "America/New_York",
  },
  {
    re: /\b(cst|central\s+standard\s+time|central\s+time)\b/i,
    iana: "America/Chicago",
  },
  { re: /\b(aest|australian\s+eastern)\b/i, iana: "Australia/Sydney" },
];

export function resolveTimezoneAlias(text: string): string | null {
  for (const row of TIMEZONE_ALIASES) {
    if (row.re.test(text)) return row.iana;
  }
  return null;
}
