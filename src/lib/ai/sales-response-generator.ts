import { AppError } from "@/lib/errors";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { extractJsonObject } from "@/lib/ai/parse-json";
import {
  SALES_RESPONSE_SYSTEM_PROMPT,
  buildSalesResponseUserPrompt,
  type SalesResponseLeadContext,
} from "@/lib/ai/prompts/sales-response";
import {
  salesResponseResultSchema,
  type SalesResponseChannel,
  type SalesResponseResult,
  type SalesResponseTone,
  type SalesResponseType,
} from "@/types/sales-response";
import type { AIProviderId } from "@/lib/ai/provider";

export type GenerateSalesResponseInput = {
  responseType: SalesResponseType;
  tone: SalesResponseTone;
  channel: SalesResponseChannel;
  lead: SalesResponseLeadContext;
};

export type GenerateSalesResponseOutput = {
  result: SalesResponseResult;
  provider: AIProviderId;
  model: string;
};

export async function generateSalesResponseDraft(
  input: GenerateSalesResponseInput
): Promise<GenerateSalesResponseOutput> {
  const provider = getAIProvider();

  const completion = await provider.generateSalesResponse({
    systemPrompt: SALES_RESPONSE_SYSTEM_PROMPT,
    userPrompt: buildSalesResponseUserPrompt(input),
  });

  let parsedJson: unknown;
  try {
    parsedJson = extractJsonObject(completion.content);
  } catch {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }

  // Force channel to the requested channel so Zod channel rules apply consistently.
  if (parsedJson && typeof parsedJson === "object") {
    (parsedJson as { channel?: string }).channel = input.channel;
    if (input.channel === "message") {
      (parsedJson as { subject?: string | null }).subject = null;
    }
  }

  const validated = salesResponseResultSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }

  return {
    result: validated.data,
    provider: completion.provider,
    model: completion.model,
  };
}
