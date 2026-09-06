import { AppError } from "@/lib/errors";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { extractJsonObject } from "@/lib/ai/parse-json";
import {
  LEAD_ANALYSIS_SYSTEM_PROMPT,
  buildLeadAnalysisUserPrompt,
} from "@/lib/ai/prompts/lead-analysis";
import {
  leadAnalysisResultSchema,
  type LeadAnalysisResult,
} from "@/types/ai";
import type { AIProviderId } from "@/lib/ai/provider";

export type LeadAnalyzerInput = {
  name: string;
  email: string;
  companyName: string;
  jobTitle?: string | null;
  industry?: string | null;
  source: string;
  message?: string | null;
  budget?: string | null;
  timeline?: string | null;
  phone?: string | null;
  dealValue?: number | null;
};

export type AnalyzeLeadOutput = {
  result: LeadAnalysisResult;
  provider: AIProviderId;
  model: string;
};

export async function analyzeLead(
  lead: LeadAnalyzerInput
): Promise<AnalyzeLeadOutput> {
  const provider = getAIProvider();

  const completion = await provider.completeLeadAnalysis({
    systemPrompt: LEAD_ANALYSIS_SYSTEM_PROMPT,
    userPrompt: buildLeadAnalysisUserPrompt(lead),
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

  const validated = leadAnalysisResultSchema.safeParse(parsedJson);
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
