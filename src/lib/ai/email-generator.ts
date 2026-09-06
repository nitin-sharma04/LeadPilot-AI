import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { extractJsonObject } from "@/lib/ai/parse-json";
import {
  EMAIL_GEMINI_SCHEMA,
  EMAIL_SYSTEM_PROMPT,
  buildEmailUserPrompt,
  type EmailLeadContext,
  type EmailToneId,
  type EmailTypeId,
} from "@/lib/ai/prompts/email";
import type { AIProviderId } from "@/lib/ai/provider";

export const aiEmailResultSchema = z.object({
  subject: z.string().min(2).max(200),
  body: z.string().min(10).max(8000),
  callToAction: z.string().min(2).max(300),
});

export type AiEmailResult = z.infer<typeof aiEmailResultSchema>;

export async function generateAiEmail(input: {
  emailType: EmailTypeId;
  tone: EmailToneId;
  lead: EmailLeadContext;
}): Promise<{
  result: AiEmailResult;
  provider: AIProviderId;
  model: string;
}> {
  if (
    input.emailType === "appointment_confirmation" &&
    !input.lead.appointmentBooked
  ) {
    throw new AppError(
      "Cannot generate an appointment confirmation — no booked appointment.",
      400
    );
  }

  const provider = getAIProvider();
  const completion = await provider.completeJsonPrompt({
    systemPrompt: EMAIL_SYSTEM_PROMPT,
    userPrompt: buildEmailUserPrompt(input),
    responseSchema: EMAIL_GEMINI_SCHEMA as unknown as Record<string, unknown>,
  });

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonObject(completion.content);
  } catch {
    throw new AppError("AI returned an invalid email response.", 502);
  }

  const validated = aiEmailResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AppError("AI returned an invalid email response.", 502);
  }

  // Safety: strip invented meet links if none provided
  let body = validated.data.body;
  if (!input.lead.meetingUrl) {
    body = body.replace(/https?:\/\/meet\.google\.com\/\S+/gi, "[meeting link TBD]");
  }

  return {
    result: {
      subject: validated.data.subject.trim(),
      body: body.trim(),
      callToAction: validated.data.callToAction.trim(),
    },
    provider: completion.provider,
    model: completion.model,
  };
}
