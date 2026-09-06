import OpenAI from "openai";
import { AppError } from "@/lib/errors";
import type { AIProvider, AIProviderCompletionResult } from "@/lib/ai/provider";
import {
  getExperientialLabsConfig,
  type ExperientialLabsConfig,
} from "@/lib/ai/experiential-labs-client";

/**
 * Experiential Labs is an OpenAI-compatible gateway.
 * Inference base: {EXPLABS_BASE_URL}/v1
 * Chat endpoint: POST /v1/chat/completions
 *
 * Per Experiential docs/quickstart: prefer a minimal body (model + messages).
 * Sampling params and response_format are omitted because some routes reject them.
 * JSON structure is enforced via prompt + Zod validation in the analyzer.
 */
export function createExperientialLabsProvider(
  config?: ExperientialLabsConfig
): AIProvider {
  const cfg = config ?? getExperientialLabsConfig();
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: `${cfg.baseUrl}/v1`,
  });

  async function completeJson(
    systemPrompt: string,
    userPrompt: string
  ): Promise<AIProviderCompletionResult> {
    const started = Date.now();
    try {
      const completion = await client.chat.completions.create({
        model: cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const content = completion.choices[0]?.message?.content ?? "";
      const durationMs = Date.now() - started;

      console.info("[ai:experiential-labs] chat.completions ok", {
        provider: "experiential-labs",
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
        provider: "experiential-labs",
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

      if (
        message.includes("insufficient_quota") ||
        message.includes("free_tier_requires_payment") ||
        message.includes("credits")
      ) {
        console.error("[ai:experiential-labs] quota exhausted", {
          provider: "experiential-labs",
          model: cfg.model,
          durationMs,
          errorType: "insufficient_quota",
        });
        throw new AppError(
          "AI credits/quota exhausted. Add credits on the Experiential Labs Credits page, then try again.",
          429
        );
      }

      if (message.includes("rate limit") || message.includes("429")) {
        console.error("[ai:experiential-labs] rate limited", {
          provider: "experiential-labs",
          model: cfg.model,
          durationMs,
          errorType: "rate_limit",
        });
        throw new AppError(
          "AI rate limit reached. Please wait a moment and try again.",
          429
        );
      }

      if (
        message.includes("401") ||
        message.includes("403") ||
        message.includes("invalid_api_key") ||
        message.includes("invalid_key") ||
        message.includes("authentication")
      ) {
        console.error("[ai:experiential-labs] auth failure", {
          provider: "experiential-labs",
          model: cfg.model,
          durationMs,
          errorType: "authentication",
        });
        throw new AppError(
          "AI provider authentication failed. Check EXPLABS_API_KEY.",
          503
        );
      }

      if (message.includes("model") && message.includes("not")) {
        console.error("[ai:experiential-labs] invalid model", {
          provider: "experiential-labs",
          model: cfg.model,
          durationMs,
          errorType: "invalid_model",
        });
        throw new AppError(
          "Configured AI model is not available. Check EXPLABS_MODEL.",
          503
        );
      }

      console.error("[ai:experiential-labs] provider failure", {
        provider: "experiential-labs",
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
    id: "experiential-labs",
    displayName: "Experiential Labs",
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
