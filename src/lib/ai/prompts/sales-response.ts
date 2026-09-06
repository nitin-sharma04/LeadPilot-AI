import type {
  SalesResponseChannel,
  SalesResponseTone,
  SalesResponseType,
} from "@/types/sales-response";
import { RESPONSE_TYPE_LABELS, TONE_LABELS, CHANNEL_LABELS } from "@/types/sales-response";

export type SalesResponseLeadContext = {
  name: string;
  companyName: string;
  jobTitle?: string | null;
  industry?: string | null;
  source: string;
  status: string;
  notes?: string | null;
  score?: number | null;
  intent?: string | null;
  urgency?: string | null;
  buyingStage?: string | null;
  requirements?: string[];
  painPoints?: string[];
  objections?: string[];
  recommendation?: string | null;
  reasoning?: string | null;
};

export const SALES_RESPONSE_SYSTEM_PROMPT = `You are an expert B2B sales copywriter helping a salesperson craft a personalized outreach message.

Rules:
- Write a genuinely personalized response using ONLY the lead context provided.
- Never fabricate facts, pricing, product capabilities, case studies, or prior conversations.
- Never claim previous communication happened unless it is explicitly supplied.
- If a detail is missing, do not invent it — write around the gap naturally.
- Avoid generic spam language, hype, and excessive sales pressure.
- Focus on the lead's actual pain points and requirements when available.
- Treat AI analysis fields as helpful context, not unquestionable truth.
- Match the selected tone and channel precisely.
- Provide exactly one clear call to action.
- Keep the message concise and human.
- Return ONLY valid JSON matching the requested schema (no markdown).

Channel rules:
- email: include a compelling subject, a polished body, and one CTA.
- message: subject must be null; keep body short (SMS/chat length), plus one CTA.

Response-type guidance:
- initial_outreach: establish relevance quickly, mention a legitimate lead-specific reason, identify a likely problem/opportunity, concise value proposition, one simple CTA.
- follow_up: do not simply repeat a prior message; add useful context; keep a natural conversational tone.
- re_engagement: avoid guilt or pressure; give a useful reason to reconnect.
- meeting_confirmation: confirm logistics only from provided facts; otherwise keep confirmation light and ask to confirm details.
- proposal_follow_up: reference evaluation context without inventing proposal terms.
- general: helpful professional sales response tailored to the lead.`;

export function buildSalesResponseUserPrompt(input: {
  responseType: SalesResponseType;
  tone: SalesResponseTone;
  channel: SalesResponseChannel;
  lead: SalesResponseLeadContext;
}): string {
  const { responseType, tone, channel, lead } = input;
  const lines: string[] = [
    `Generate a ${CHANNEL_LABELS[channel].toLowerCase()} sales response.`,
    `Response type: ${RESPONSE_TYPE_LABELS[responseType]}`,
    `Tone: ${TONE_LABELS[tone]}`,
    `Channel: ${CHANNEL_LABELS[channel]}`,
    "",
    "Lead context (use only what is present):",
    `- Name: ${lead.name}`,
    `- Company: ${lead.companyName}`,
  ];

  if (lead.jobTitle) lines.push(`- Job title: ${lead.jobTitle}`);
  if (lead.industry) lines.push(`- Industry: ${lead.industry}`);
  lines.push(`- Lead source: ${lead.source}`);
  lines.push(`- Lead status: ${lead.status}`);
  if (lead.notes?.trim()) lines.push(`- Lead notes/message: ${lead.notes.trim()}`);
  if (typeof lead.score === "number") lines.push(`- Lead score: ${lead.score}`);
  if (lead.intent) lines.push(`- Intent: ${lead.intent}`);
  if (lead.urgency) lines.push(`- Urgency: ${lead.urgency}`);
  if (lead.buyingStage) lines.push(`- Buying stage: ${lead.buyingStage}`);
  if (lead.requirements?.length) {
    lines.push(`- Requirements: ${lead.requirements.join("; ")}`);
  }
  if (lead.painPoints?.length) {
    lines.push(`- Pain points: ${lead.painPoints.join("; ")}`);
  }
  if (lead.objections?.length) {
    lines.push(`- Objections: ${lead.objections.join("; ")}`);
  }
  if (lead.recommendation) {
    lines.push(`- AI recommendation (context only): ${lead.recommendation}`);
  }
  if (lead.reasoning) {
    lines.push(`- AI reasoning (context only): ${lead.reasoning}`);
  }

  lines.push(
    "",
    "Return JSON with this exact shape:",
    '{',
    '  "channel": "email" | "message",',
    '  "subject": "string | null",',
    '  "body": "string",',
    '  "callToAction": "string",',
    '  "personalizationNotes": ["string"]',
    "}",
    "",
    `Set channel to "${channel}".`,
    channel === "message"
      ? "Set subject to null for short messages."
      : "Provide a non-empty subject for email.",
    "personalizationNotes should briefly list the real lead details you used (or be empty)."
  );

  return lines.join("\n");
}

/** Gemini OpenAPI-style schema for structured sales response output. */
export const SALES_RESPONSE_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    channel: { type: "STRING", enum: ["email", "message"] },
    subject: { type: "STRING", nullable: true },
    body: { type: "STRING" },
    callToAction: { type: "STRING" },
    personalizationNotes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["channel", "body", "callToAction", "personalizationNotes"],
} as const;
