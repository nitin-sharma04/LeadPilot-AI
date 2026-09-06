import type { LeadAnalysisResult } from "@/types/ai";

export type AIProviderId =
  | "gemini"
  | "openai"
  | "experiential-labs"
  | "qwen";

export type AIProviderCompletionResult = {
  provider: AIProviderId;
  model: string;
  content: string;
  durationMs: number;
  httpStatus?: number;
};

export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;
  completeLeadAnalysis(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<AIProviderCompletionResult>;
  generateSalesResponse(input: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<AIProviderCompletionResult>;
  /** Voice agent turn / call summary / other JSON completions */
  completeJsonPrompt(input: {
    systemPrompt: string;
    userPrompt: string;
    responseSchema?: Record<string, unknown>;
  }): Promise<AIProviderCompletionResult>;
}

export type { LeadAnalysisResult };
