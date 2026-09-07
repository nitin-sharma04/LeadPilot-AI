import { PrismaClient } from "@prisma/client";
import { resolveCustomVocabulary } from "./config.js";
import { REALTIME_HUMAN_SDR_PROMPT } from "./prompts.js";

export const prisma = new PrismaClient();

export async function validateStreamSession(input: {
  callId: string;
  streamToken: string;
}) {
  const call = await prisma.call.findFirst({
    where: {
      id: input.callId,
      streamToken: input.streamToken,
      voiceMode: "realtime",
      status: { in: ["INITIATING", "RINGING", "IN_PROGRESS", "CONNECTED"] },
    },
    include: {
      lead: { include: { analysis: true } },
      company: true,
      agent: true,
    },
  });
  return call;
}

export async function appendTranscript(input: {
  callId: string;
  speaker: "AI" | "LEAD";
  message: string;
}) {
  const text = input.message.trim();
  if (!text) return;
  await prisma.callTranscript.create({
    data: {
      callId: input.callId,
      speaker: input.speaker,
      message: text.slice(0, 4000),
    },
  });
}

/** Soft metadata only — never marks the call completed (Twilio status webhook does). */
export async function noteCallEndReason(input: {
  callId: string;
  reason: string;
}) {
  try {
    await appendTranscript({
      callId: input.callId,
      speaker: "AI",
      message: `[system] Call end requested: ${input.reason.slice(0, 80)}`,
    });
  } catch {
    /* ignore — hangup must not depend on this */
  }
}

export function buildSystemInstruction(
  call: NonNullable<Awaited<ReturnType<typeof validateStreamSession>>>
): string {
  const lead = call.lead;
  const analysis = lead.analysis;
  const agentName = call.agent?.name?.split(" ")[0] || "Alex";
  const seller = call.company.name;
  const companyTimezone = call.company.timezone || "UTC";

  const vocab = resolveCustomVocabulary([
    seller,
    lead.name,
    lead.companyName,
    agentName,
    analysis?.industry || lead.industry || "",
  ].filter(Boolean));

  const privateContext = [
    `Lead name: ${lead.name}`,
    `Lead company: ${lead.companyName}`,
    lead.jobTitle ? `Title: ${lead.jobTitle}` : null,
    lead.industry || analysis?.industry
      ? `Industry: ${analysis?.industry || lead.industry}`
      : null,
    `Company default timezone: ${companyTimezone}`,
    analysis?.intent ? `Internal intent signal: ${analysis.intent}` : null,
    analysis?.urgency ? `Internal urgency signal: ${analysis.urgency}` : null,
    analysis?.buyingStage ? `Buying stage: ${analysis.buyingStage}` : null,
    analysis?.requirements?.length
      ? `Requirements: ${analysis.requirements.join("; ")}`
      : null,
    analysis?.painPoints?.length
      ? `Pain points: ${analysis.painPoints.join("; ")}`
      : null,
    analysis?.recommendation
      ? `Internal recommendation: ${analysis.recommendation}`
      : null,
    lead.message ? `Lead notes: ${lead.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${REALTIME_HUMAN_SDR_PROMPT}

You are calling as ${agentName} on behalf of ${seller}.
Address the lead as ${lead.name.split(" ")[0]} when natural.

TIMEZONE RULES FOR THIS CALL:
- Company default timezone: ${companyTimezone}
- Never invent Pacific Time.
- If the lead says IST / India time, confirm in IST.

CUSTOM VOCABULARY / NAMES (pronounce and recognize accurately):
${vocab.join(", ")}

PRIVATE CONTEXT (never read scores aloud):
${privateContext}

Opening: on [EVENT:call_answered], greet casually — name, who you are, company, ask if they have a quick minute. One short question only.`;
}
