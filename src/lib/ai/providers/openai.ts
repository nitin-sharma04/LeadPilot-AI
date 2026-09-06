import OpenAI from "openai";
import { AppError } from "@/lib/errors";
import type { AIProvider, AIProviderCompletionResult } from "@/lib/ai/provider";

function getOpenAIConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "AI analysis is not configured. Set OPENAI_API_KEY on the server.",
      503
    );
  }
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return { apiKey, model };
}

/**
 * Optional OpenAI provider kept behind the same interface.
 * Only required when AI_PROVIDER=openai.
 */
export function createOpenAIProvider(): AIProvider {
  const cfg = getOpenAIConfig();
  const client = new OpenAI({ apiKey: cfg.apiKey });

  async function completeJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<AIProviderCompletionResult> {
    const started = Date.now();
    try {
      const completion = await client.chat.completions.create({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = completion.choices[0]?.message?.content ?? "";
      const durationMs = Date.now() - started;

      console.info("[ai:openai] chat.completions ok", {
        provider: "openai",
        model: cfg.model,
        durationMs,
        httpStatus: 200,
      });

      if (!content.trim()) {
        throw new AppError(
          "Unable to complete the AI request right now. Please try again.",
          502
        );
      }

      return {
        provider: "openai",
        model: cfg.model,
        content,
        durationMs,
        httpStatus: 200,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      const message =
        error instanceof Error ? error.message.toLowerCase() : "";
      const durationMs = Date.now() - started;

      if (message.includes("rate limit")) {
        console.error("[ai:openai] rate limited", {
          provider: "openai",
          model: cfg.model,
          durationMs,
          errorType: "rate_limit",
        });
        throw new AppError(
          "AI rate limit reached. Please wait a moment and try again.",
          429
        );
      }

      console.error("[ai:openai] provider failure", {
        provider: "openai",
        model: cfg.model,
        durationMs,
        errorType: "provider_error",
      });

      throw new AppError(
        "Unable to complete the AI request right now. Please try again.",
        502
      );
    }
  }

  return {
    id: "openai",
    displayName: "OpenAI",
    completeLeadAnalysis({ systemPrompt, userPrompt }) {
      return completeJson(systemPrompt, userPrompt);
    },
    generateSalesResponse({ systemPrompt, userPrompt }) {
      return completeJson(systemPrompt, userPrompt);
    },
    completeJsonPrompt({ systemPrompt, userPrompt }) {
      return completeJson(systemPrompt, userPrompt);
    },
  };
}
