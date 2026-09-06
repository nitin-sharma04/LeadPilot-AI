/**
 * AI email generation prompts + Gemini response schema.
 */

export type EmailTypeId =
  | "intro"
  | "follow_up"
  | "post_call"
  | "appointment_confirmation"
  | "appointment_reminder"
  | "post_meeting"
  | "re_engagement"
  | "custom";

export type EmailToneId =
  | "professional"
  | "friendly"
  | "concise"
  | "consultative";

export type EmailLeadContext = {
  leadName: string;
  leadEmail: string;
  companyName: string;
  industry?: string | null;
  jobTitle?: string | null;
  source?: string | null;
  score?: number | null;
  buyingStage?: string | null;
  requirements?: string[];
  painPoints?: string[];
  objections?: string[];
  recommendation?: string | null;
  callSummary?: string | null;
  appointmentWhen?: string | null;
  appointmentTimezone?: string | null;
  meetingUrl?: string | null;
  appointmentBooked: boolean;
  previousEmailSubject?: string | null;
  sellerCompanyName: string;
};

export const EMAIL_SYSTEM_PROMPT = `You write concise B2B sales emails for LeadPilot.

RULES:
- Never invent facts, pricing, guarantees, or meeting links.
- Never claim an appointment is booked unless appointmentBooked is true.
- Never claim a meeting link exists unless meetingUrl is provided.
- One clear CTA.
- No robotic AI filler ("I hope this email finds you well").
- Keep body under ~180 words.
- Personalize only from provided context.
- Return JSON only.`;

export function buildEmailUserPrompt(input: {
  emailType: EmailTypeId;
  tone: EmailToneId;
  lead: EmailLeadContext;
}): string {
  const l = input.lead;
  return `Write a ${input.tone} ${input.emailType} email.

Seller company: ${l.sellerCompanyName}
Lead: ${l.leadName} <${l.leadEmail}>
Lead company: ${l.companyName}
Industry: ${l.industry || "unknown"}
Title: ${l.jobTitle || "unknown"}
Source: ${l.source || "unknown"}
Score: ${l.score ?? "n/a"}
Buying stage: ${l.buyingStage || "unknown"}
Requirements: ${(l.requirements || []).join("; ") || "none"}
Pain points: ${(l.painPoints || []).join("; ") || "none"}
Objections: ${(l.objections || []).join("; ") || "none"}
Recommendation: ${l.recommendation || "none"}
Call summary: ${l.callSummary || "none"}
Appointment booked: ${l.appointmentBooked ? "yes" : "no"}
Appointment when: ${l.appointmentWhen || "n/a"}
Appointment timezone: ${l.appointmentTimezone || "n/a"}
Meeting URL: ${l.meetingUrl || "none — do not invent"}
Previous email subject: ${l.previousEmailSubject || "none"}

Return JSON:
{
  "subject": "string",
  "body": "string plain text email body",
  "callToAction": "string short CTA"
}`;
}

export const EMAIL_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    body: { type: "STRING" },
    callToAction: { type: "STRING" },
  },
  required: ["subject", "body", "callToAction"],
} as const;
