import { AppError } from "@/lib/errors";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { extractJsonObject } from "@/lib/ai/parse-json";
import { geminiGenerateContentFast } from "@/lib/ai/gemini-client";
import {
  VOICE_AGENT_SYSTEM_PROMPT,
  VOICE_TURN_GEMINI_SCHEMA,
  VOICE_AGENT_FAST_SYSTEM_PROMPT,
  buildVoiceAgentOpeningPrompt,
  buildVoiceAgentTurnPrompt,
  buildVoiceAgentFastTurnPrompt,
  type VoiceAgentLeadContext,
} from "@/lib/ai/prompts/voice-agent";
import {
  CALL_SUMMARY_SYSTEM_PROMPT,
  CALL_SUMMARY_GEMINI_SCHEMA,
  buildCallSummaryUserPrompt,
} from "@/lib/ai/prompts/call-summary";
import {
  callSummaryResultSchema,
  voiceTurnResultSchema,
  type CallSummaryResult,
  type VoiceTurnResult,
} from "@/types/voice";

async function completeAndParse<T>(
  input: {
    systemPrompt: string;
    userPrompt: string;
    responseSchema?: Record<string, unknown>;
  },
  schema: {
    safeParse: (
      v: unknown
    ) => { success: true; data: T } | { success: false };
  }
): Promise<T> {
  const provider = getAIProvider();
  const completion = await provider.completeJsonPrompt(input);
  let parsed: unknown;
  try {
    parsed = extractJsonObject(completion.content);
  } catch {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }
  return validated.data;
}

export async function generateVoiceOpening(
  lead: VoiceAgentLeadContext
): Promise<VoiceTurnResult> {
  return completeAndParse(
    {
      systemPrompt: VOICE_AGENT_SYSTEM_PROMPT,
      userPrompt: buildVoiceAgentOpeningPrompt(lead),
      responseSchema: VOICE_TURN_GEMINI_SCHEMA as unknown as Record<
        string,
        unknown
      >,
    },
    voiceTurnResultSchema
  );
}

export async function generateVoiceTurn(input: {
  lead: VoiceAgentLeadContext;
  transcript: Array<{ speaker: "agent" | "lead"; text: string }>;
  leadUtterance: string;
}): Promise<VoiceTurnResult> {
  return completeAndParse(
    {
      systemPrompt: VOICE_AGENT_SYSTEM_PROMPT,
      userPrompt: buildVoiceAgentTurnPrompt(input),
      responseSchema: VOICE_TURN_GEMINI_SCHEMA as unknown as Record<
        string,
        unknown
      >,
    },
    voiceTurnResultSchema
  );
}

/** Fast path for live Twilio Gather — avoids schema retries and long prompts. */
export async function generateVoiceTurnFast(input: {
  lead: VoiceAgentLeadContext;
  transcript: Array<{ speaker: "agent" | "lead"; text: string }>;
  leadUtterance: string;
}): Promise<VoiceTurnResult> {
  const completion = await geminiGenerateContentFast({
    systemPrompt: VOICE_AGENT_FAST_SYSTEM_PROMPT,
    userPrompt: buildVoiceAgentFastTurnPrompt(input),
    timeoutMs: 6_000,
  });

  let parsed: unknown;
  try {
    parsed = extractJsonObject(completion.text);
  } catch {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }
  const validated = voiceTurnResultSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }
  const reply = validated.data.reply.replace(/\s+/g, " ").trim().slice(0, 280);
  return { ...validated.data, reply };
}

export async function generateCallSummary(input: {
  leadName: string;
  companyName: string;
  transcript: Array<{ speaker: string; text: string }>;
}): Promise<CallSummaryResult> {
  return completeAndParse(
    {
      systemPrompt: CALL_SUMMARY_SYSTEM_PROMPT,
      userPrompt: buildCallSummaryUserPrompt(input),
      responseSchema: CALL_SUMMARY_GEMINI_SCHEMA as unknown as Record<
        string,
        unknown
      >,
    },
    callSummaryResultSchema
  );
}
