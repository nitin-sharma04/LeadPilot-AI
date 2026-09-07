/**
 * Explicit end-call / hangup intent detection from lead speech.
 */

const END_CALL_PATTERNS: RegExp[] = [
  /\bgood\s*bye\b/i,
  /\bgoodbye\b/i,
  /\bbye[\s!.]*$/i,
  /\bbye\b/i,
  /\bthanks?,?\s+(that'?s|that is)\s+all\b/i,
  /\bthanks?,?\s*bye\b/i,
  /\bthat'?s\s+all\b/i,
  /\bthat'?s\s+all\s+i\s+needed\b/i,
  /\bwe'?re\s+done\b/i,
  /\bi'?m\s+done\b/i,
  /\bi\s+have\s+to\s+go\b/i,
  /\bend\s+the\s+call\b/i,
  /\bhang\s*up\b/i,
  /\bplease\s+hang\s*up\b/i,
  /\bstop\s+the\s+call\b/i,
  /\bno\s+more\s+questions\b/i,
  /\bstop\s+(calling|talking|the\s+call)\b/i,
  /\bi\s+don'?t\s+want\s+to\s+(talk|continue|be\s+contacted)\b/i,
  /\byou\s+can\s+hang\s*up\s+now\b/i,
];

const FORCE_HANGUP_PATTERNS: RegExp[] = [
  /\bwhy\s+(aren'?t|are\s+not)\s+you\s+hanging\s+up\b/i,
  /\bwhy\s+(are\s+you|haven'?t\s+you)\s+(still\s+)?(on\s+the\s+call|hanging\s+up)\b/i,
  /\bwhy\s+haven'?t\s+you\s+hung\s+up\b/i,
  /\bwhy\s+are\s+you\s+still\s+on\s+(the\s+)?call\b/i,
  /\byou\s+can\s+hang\s*up\s+now\b/i,
];

const AGENT_FAREWELL_PATTERNS: RegExp[] = [
  /\bhave a (great|good|wonderful|nice) (day|evening|one)\b/i,
  /\bthanks for (your )?time\b/i,
  /\bthank you for (your )?time\b/i,
  /\btalk (to you |with you )?soon\b/i,
  /\btake care\b/i,
  /\bgoodbye\b/i,
  /\bgood\s*bye\b/i,
  /\bbye for now\b/i,
  /\bwe'?ll be in touch\b/i,
];

export function detectsEndCallIntent(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  // Bare acknowledgements / affirmations are NOT hangup.
  if (/^(okay|ok|sure|yes|yeah|yep|alright|right|perfect)\.?$/i.test(text)) {
    return false;
  }
  // Meeting / schedule requests are NEVER hangup by themselves.
  if (
    /\b(schedule|meeting|appointment|book|calendar)\b/i.test(text) &&
    !/\b(good\s*bye|goodbye|hang\s*up|end\s+the\s+call)\b/i.test(text)
  ) {
    return false;
  }
  if (detectsForceHangupIntent(text)) return true;
  return END_CALL_PATTERNS.some((re) => re.test(text));
}

export function detectsForceHangupIntent(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  return FORCE_HANGUP_PATTERNS.some((re) => re.test(text));
}

export function detectsAgentFarewell(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\?/.test(text)) return false;
  return AGENT_FAREWELL_PATTERNS.some((re) => re.test(text));
}

/**
 * Appointment must not be treated as confirmed on unclear audio.
 */
export function isClearAppointmentConfirmation(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || text === "[unclear]") return false;
  if (/^(uh+|um+|er+|ah+|\.\.\.|…)$/i.test(text)) return false;
  if (
    /\b(yes|yeah|yep|sure|sounds good|that works|works for me|perfect|okay|ok|confirm|confirmed|book it|let'?s do it)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

export function isUnclearUtterance(utterance: string): boolean {
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (text === "[unclear]") return true;
  if (/^(uh+|um+|er+|ah+|\.\.\.|…)$/i.test(text)) return true;
  return false;
}
