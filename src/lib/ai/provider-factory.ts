import { AppError } from "@/lib/errors";
import type { AIProvider, AIProviderId } from "@/lib/ai/provider";
import { createExperientialLabsProvider } from "@/lib/ai/providers/experiential-labs";
import { createGeminiProvider } from "@/lib/ai/providers/gemini";
import { createOpenAIProvider } from "@/lib/ai/providers/openai";

/**
 * Resolves AI_PROVIDER into a known provider id.
 * Default: gemini
 */
export function resolveAIProviderId(
  value: string | undefined = process.env.AI_PROVIDER
): AIProviderId {
  const normalized = (value ?? "gemini").trim().toLowerCase();

  if (normalized === "gemini" || normalized === "google" || normalized === "google-gemini") {
    return "gemini";
  }
  if (normalized === "openai") return "openai";
  if (
    normalized === "experiential-labs" ||
    normalized === "experiential" ||
    normalized === "explabs"
  ) {
    return "experiential-labs";
  }
  if (normalized === "qwen") {
    throw new AppError(
      "AI_PROVIDER=qwen is reserved but not configured yet. Use gemini, openai, or experiential-labs.",
      503
    );
  }

  throw new AppError(
    "Invalid AI_PROVIDER. Use gemini, openai, or experiential-labs.",
    503
  );
}

export function getAIProvider(providerId?: AIProviderId): AIProvider {
  const id = providerId ?? resolveAIProviderId();
  if (id === "openai") return createOpenAIProvider();
  if (id === "experiential-labs") return createExperientialLabsProvider();
  return createGeminiProvider();
}
