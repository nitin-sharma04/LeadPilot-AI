export const CALL_SUMMARY_SYSTEM_PROMPT = `You summarize completed B2B sales qualification phone calls.

Rules:
- Use only the transcript and supplied context.
- Never invent facts.
- Be concise and actionable.
- Do NOT mark an appointment as booked unless the transcript clearly shows a real booking confirmation from a connected calendar/system.
- Distinguishing preferred/proposed meeting time vs actually booked is required.
- If speech was marked [unclear], do not invent what was said.
- Return ONLY valid JSON.

Schema:
{
  "summary": "string",
  "outcome": "qualified" | "not_interested" | "callback_requested" | "appointment_requested" | "no_answer" | "unknown",
  "interestLevel": "low" | "medium" | "high",
  "keyRequirements": ["string"],
  "painPoints": ["string"],
  "objections": ["string"],
  "nextAction": "string",
  "followUpRecommended": true,
  "preferredMeetingTime": "string or empty",
  "appointmentActuallyBooked": false,
  "appointmentOnlyProposed": true
}`;

export function buildCallSummaryUserPrompt(input: {
  leadName: string;
  companyName: string;
  transcript: Array<{ speaker: string; text: string }>;
}): string {
  const lines = input.transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");
  return `Summarize this call with ${input.leadName} at ${input.companyName}.

Capture accurately:
- outcome and interest level
- lead needs / requested features
- pain points and objections
- timeline and budget if mentioned
- preferred meeting date/time if any
- whether an appointment was ONLY proposed/preferred vs actually booked (default: not booked)
- follow-up recommendation

Transcript:
${lines || "(no transcript captured)"}

Return the JSON summary now.`;
}

export const CALL_SUMMARY_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    outcome: {
      type: "STRING",
      enum: [
        "qualified",
        "not_interested",
        "callback_requested",
        "appointment_requested",
        "no_answer",
        "unknown",
      ],
    },
    interestLevel: { type: "STRING", enum: ["low", "medium", "high"] },
    keyRequirements: { type: "ARRAY", items: { type: "STRING" } },
    painPoints: { type: "ARRAY", items: { type: "STRING" } },
    objections: { type: "ARRAY", items: { type: "STRING" } },
    nextAction: { type: "STRING" },
    followUpRecommended: { type: "BOOLEAN" },
    preferredMeetingTime: { type: "STRING" },
    appointmentActuallyBooked: { type: "BOOLEAN" },
    appointmentOnlyProposed: { type: "BOOLEAN" },
  },
  required: [
    "summary",
    "outcome",
    "interestLevel",
    "keyRequirements",
    "painPoints",
    "objections",
    "nextAction",
    "followUpRecommended",
    "preferredMeetingTime",
    "appointmentActuallyBooked",
    "appointmentOnlyProposed",
  ],
} as const;
