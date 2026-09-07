export type VoiceAgentLeadContext = {
  name: string;
  companyName: string;
  jobTitle?: string | null;
  industry?: string | null;
  source?: string | null;
  notes?: string | null;
  score?: number | null;
  intent?: string | null;
  urgency?: string | null;
  buyingStage?: string | null;
  requirements?: string[];
  painPoints?: string[];
  objections?: string[];
  recommendation?: string | null;
  agentName?: string;
  sellerCompanyName?: string;
};

/** Shared behavioral rules for turn-based (5A) and realtime (5B) voice agents. */
export const VOICE_AGENT_BEHAVIOR = `ROLE:
Professional AI sales development representative. Identify yourself honestly as an AI assistant when required.

GOAL:
Qualify the lead and determine the best next action (callback, meeting, human handoff, or polite close).

BEHAVIOR:
- Natural, concise, professional spoken language.
- One question at a time.
- Listen before responding; acknowledge what the customer said.
- Avoid long monologues and robotic paragraphs.
- Handle objections politely.
- Never fabricate facts, pricing, features, or prior conversations.
- Never promise unavailable capabilities.
- Never reveal internal CRM scores, lead scores, or private analysis.
- Respect opt-out requests and end immediately if asked not to be contacted.
- Never claim to be human.
- Do not use markdown, lists, or stage directions.`;

/** Phase 5A turn-based: Gemini text JSON → Twilio <Say>. */
export const VOICE_AGENT_SYSTEM_PROMPT = `You are a professional AI sales development representative on a live phone call.

${VOICE_AGENT_BEHAVIOR}

If the customer asks not to be contacted, politely end the call (endCall=true).
If they request a human representative, acknowledge and end with handoffRequested=true.
If they want an appointment, capture the requested time in reply and set appointmentRequested=true.

Return ONLY valid JSON:
{
  "reply": "string spoken aloud",
  "endCall": boolean,
  "handoffRequested": boolean,
  "appointmentRequested": boolean,
  "optOut": boolean
}`;

/**
 * Phase 5B realtime: Gemini Live native audio (no JSON envelope).
 * @see src/lib/ai/prompts/realtime-voice.ts and voice-server/src/prompts.ts
 */
export { REALTIME_HUMAN_SDR_PROMPT as REALTIME_VOICE_AGENT_SYSTEM_PROMPT } from "./realtime-voice";

export function buildVoiceAgentOpeningPrompt(
  lead: VoiceAgentLeadContext
): string {
  return `Create the opening spoken line for an outbound qualification call.

Seller company: ${lead.sellerCompanyName || "our team"}
Agent name: ${lead.agentName || "Alex"}
Lead name: ${lead.name}
Lead company: ${lead.companyName}
${lead.jobTitle ? `Job title: ${lead.jobTitle}` : ""}
${lead.industry ? `Industry: ${lead.industry}` : ""}
${lead.notes ? `Lead message/notes (private context): ${lead.notes}` : ""}
${lead.painPoints?.length ? `Likely pain points (private): ${lead.painPoints.join("; ")}` : ""}
${lead.requirements?.length ? `Requirements (private): ${lead.requirements.join("; ")}` : ""}

Introduce yourself as an AI assistant, confirm they have a moment, and briefly explain you are following up on their interest. Do not reveal scores. Keep it under 45 words.
Set endCall=false unless context already indicates do-not-call.`;
}

export function buildVoiceAgentTurnPrompt(input: {
  lead: VoiceAgentLeadContext;
  transcript: Array<{ speaker: "agent" | "lead"; text: string }>;
  leadUtterance: string;
}): string {
  const history = input.transcript
    .slice(-12)
    .map((t) => `${t.speaker === "agent" ? "Agent" : "Lead"}: ${t.text}`)
    .join("\n");

  return `Continue the live phone conversation.

Private lead context (never reveal scores):
- Name: ${input.lead.name}
- Company: ${input.lead.companyName}
${input.lead.jobTitle ? `- Title: ${input.lead.jobTitle}` : ""}
${input.lead.industry ? `- Industry: ${input.lead.industry}` : ""}
${input.lead.intent ? `- Intent signal: ${input.lead.intent}` : ""}
${input.lead.urgency ? `- Urgency signal: ${input.lead.urgency}` : ""}
${input.lead.buyingStage ? `- Buying stage: ${input.lead.buyingStage}` : ""}
${input.lead.painPoints?.length ? `- Pain points: ${input.lead.painPoints.join("; ")}` : ""}
${input.lead.requirements?.length ? `- Requirements: ${input.lead.requirements.join("; ")}` : ""}
${input.lead.objections?.length ? `- Objections: ${input.lead.objections.join("; ")}` : ""}
${input.lead.recommendation ? `- Internal recommendation: ${input.lead.recommendation}` : ""}

Recent transcript:
${history || "(none yet)"}

Latest lead utterance:
"""
${input.leadUtterance}
"""

Respond with the next short spoken reply as JSON.`;
}

/** Shorter system prompt for low-latency Gather turns. */
export const VOICE_AGENT_FAST_SYSTEM_PROMPT = `You are an AI sales assistant on a live phone call.
Speak naturally and briefly (1-2 short sentences, under 35 words).
One question at a time. Never claim to be human. No markdown.
Return ONLY JSON: {"reply":"string","endCall":boolean,"handoffRequested":boolean,"appointmentRequested":boolean,"optOut":boolean}`;

export function buildVoiceAgentFastTurnPrompt(input: {
  lead: VoiceAgentLeadContext;
  transcript: Array<{ speaker: "agent" | "lead"; text: string }>;
  leadUtterance: string;
}): string {
  const history = input.transcript
    .slice(-6)
    .map((t) => `${t.speaker === "agent" ? "A" : "L"}: ${t.text}`)
    .join("\n");

  return `Seller: ${input.lead.sellerCompanyName || "our team"}
Agent: ${input.lead.agentName || "Alex"}
Lead: ${input.lead.name} (${input.lead.companyName})
Recent:
${history || "(none)"}
Lead just said: "${input.leadUtterance}"
Reply now as JSON.`;
}

export const VOICE_TURN_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    endCall: { type: "BOOLEAN" },
    handoffRequested: { type: "BOOLEAN" },
    appointmentRequested: { type: "BOOLEAN" },
    optOut: { type: "BOOLEAN" },
  },
  required: [
    "reply",
    "endCall",
    "handoffRequested",
    "appointmentRequested",
    "optOut",
  ],
} as const;
