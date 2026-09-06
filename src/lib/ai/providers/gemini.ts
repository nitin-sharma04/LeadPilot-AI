import type { AIProvider, AIProviderCompletionResult } from "@/lib/ai/provider";
import {
  geminiGenerateContent,
  getGeminiConfig,
  LEAD_ANALYSIS_RESPONSE_SCHEMA,
} from "@/lib/ai/gemini-client";
import { SALES_RESPONSE_GEMINI_SCHEMA } from "@/lib/ai/prompts/sales-response";

/**
 * Google Gemini provider via Generative Language API generateContent.
 * Active when AI_PROVIDER=gemini.
 */
export function createGeminiProvider(): AIProvider {
  const cfg = getGeminiConfig();

  async function complete(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: Record<string, unknown>
  ): Promise<AIProviderCompletionResult> {
    const result = await geminiGenerateContent({
      systemPrompt,
      userPrompt,
      config: cfg,
      responseSchema,
    });

    return {
      provider: "gemini",
      model: result.model,
      content: result.text,
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
    };
  }

  return {
    id: "gemini",
    displayName: "Gemini",
    completeLeadAnalysis({ systemPrompt, userPrompt }) {
      return complete(
        systemPrompt,
        userPrompt,
        LEAD_ANALYSIS_RESPONSE_SCHEMA as unknown as Record<string, unknown>
      );
    },
    generateSalesResponse({ systemPrompt, userPrompt }) {
      return complete(
        systemPrompt,
        userPrompt,
        SALES_RESPONSE_GEMINI_SCHEMA as unknown as Record<string, unknown>
      );
    },
    completeJsonPrompt({ systemPrompt, userPrompt, responseSchema }) {
      return complete(systemPrompt, userPrompt, responseSchema);
    },
  };
}
