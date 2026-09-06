import { AppError } from "@/lib/errors";

export type GeminiConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
};

export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";
/** Stable fallback when the configured alias returns UNAVAILABLE/404. */
export const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";
export const GEMINI_DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_TIMEOUT_MS = 45_000;

/** JSON Schema for Gemini structured output (OpenAPI-style types). */
export const LEAD_ANALYSIS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    score: { type: "INTEGER" },
    intent: { type: "STRING", enum: ["low", "medium", "high"] },
    urgency: { type: "STRING", enum: ["low", "medium", "high"] },
    estimatedBudget: { type: "STRING" },
    industry: { type: "STRING" },
    buyingStage: {
      type: "STRING",
      enum: ["researching", "evaluating", "ready_to_buy", "unknown"],
    },
    requirements: { type: "ARRAY", items: { type: "STRING" } },
    painPoints: { type: "ARRAY", items: { type: "STRING" } },
    objections: { type: "ARRAY", items: { type: "STRING" } },
    recommendation: { type: "STRING" },
    reasoning: { type: "STRING" },
  },
  required: [
    "score",
    "intent",
    "urgency",
    "estimatedBudget",
    "industry",
    "buyingStage",
    "requirements",
    "painPoints",
    "objections",
    "recommendation",
    "reasoning",
  ],
} as const;

export function getGeminiConfig(): GeminiConfig {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "AI analysis is not configured. Set GEMINI_API_KEY on the server.",
      503
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const baseUrl = (
    process.env.GEMINI_BASE_URL?.trim() || GEMINI_DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const timeoutMs =
    Number(process.env.GEMINI_TIMEOUT_MS) > 0
      ? Number(process.env.GEMINI_TIMEOUT_MS)
      : GEMINI_DEFAULT_TIMEOUT_MS;

  return { apiKey, model, baseUrl, timeoutMs };
}

export type GeminiGenerateContentResult = {
  text: string;
  httpStatus: number;
  durationMs: number;
  model: string;
  usedResponseSchema: boolean;
};

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};

type GeminiErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GenerationConfig = {
  temperature: number;
  responseMimeType: "application/json";
  responseSchema?: Record<string, unknown>;
};

/**
 * Calls Gemini Generative Language API:
 * POST {baseUrl}/models/{model}:generateContent
 * Auth: X-goog-api-key (never logged or returned).
 *
 * Prefers documented JSON + responseSchema structured output.
 * If the model returns UNAVAILABLE/503 with schema (common on some flash aliases),
 * retries once with responseMimeType JSON only; Zod still validates.
 * If the configured model is unavailable/missing, retries with GEMINI_FALLBACK_MODEL
 * (or GEMINI_FALLBACK_MODEL env override).
 */
export async function geminiGenerateContent(input: {
  systemPrompt: string;
  userPrompt: string;
  config?: GeminiConfig;
  /** Optional Gemini responseSchema. Defaults to lead-analysis schema. */
  responseSchema?: Record<string, unknown>;
}): Promise<GeminiGenerateContentResult> {
  const cfg = input.config ?? getGeminiConfig();
  const responseSchema =
    input.responseSchema ?? (LEAD_ANALYSIS_RESPONSE_SCHEMA as unknown as Record<string, unknown>);
  const fallbackModel =
    process.env.GEMINI_FALLBACK_MODEL?.trim() || GEMINI_FALLBACK_MODEL;

  try {
    return await generateWithSchemaFallback(
      input.systemPrompt,
      input.userPrompt,
      cfg,
      responseSchema
    );
  } catch (error) {
    const shouldSwitchModel =
      error instanceof AppError &&
      (error.message.includes("temporarily unavailable") ||
        error.message.includes("high demand") ||
        error.message.includes("model is not available")) &&
      cfg.model !== fallbackModel;

    if (!shouldSwitchModel) throw error;

    console.info("[ai:gemini] retrying with fallback model", {
      provider: "gemini",
      model: cfg.model,
      fallbackModel,
      errorType: "model_fallback",
    });

    return await generateWithSchemaFallback(
      input.systemPrompt,
      input.userPrompt,
      {
        ...cfg,
        model: fallbackModel,
      },
      responseSchema
    );
  }
}

async function generateWithSchemaFallback(
  systemPrompt: string,
  userPrompt: string,
  cfg: GeminiConfig,
  responseSchema: Record<string, unknown>
): Promise<GeminiGenerateContentResult> {
  try {
    return await callGenerateContent(
      systemPrompt,
      userPrompt,
      cfg,
      true,
      responseSchema
    );
  } catch (error) {
    const canFallback =
      error instanceof AppError &&
      (error.status === 503 || error.status === 429) &&
      (error.message.includes("temporarily unavailable") ||
        error.message.includes("high demand"));

    if (canFallback) {
      console.info("[ai:gemini] retrying without responseSchema", {
        provider: "gemini",
        model: cfg.model,
        errorType: "schema_fallback",
      });
      return await callGenerateContent(
        systemPrompt,
        userPrompt,
        cfg,
        false,
        responseSchema
      );
    }
    throw error;
  }
}

async function callGenerateContent(
  systemPrompt: string,
  userPrompt: string,
  cfg: GeminiConfig,
  useSchema: boolean,
  responseSchema: Record<string, unknown>
): Promise<GeminiGenerateContentResult> {
  const url = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  const generationConfig: GenerationConfig = {
    temperature: 0.2,
    responseMimeType: "application/json",
  };
  if (useSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": cfg.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[ai:gemini] timeout", {
        provider: "gemini",
        model: cfg.model,
        durationMs,
        errorType: "timeout",
        usedResponseSchema: useSchema,
      });
      throw new AppError("AI provider timed out. Please try again.", 504);
    }
    console.error("[ai:gemini] network failure", {
      provider: "gemini",
      model: cfg.model,
      durationMs,
      errorType: "network",
      usedResponseSchema: useSchema,
    });
    throw new AppError(
      "Unable to reach the AI provider. Please try again.",
      502
    );
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - started;
  const rawText = await response.text();

  if (!response.ok) {
    mapGeminiHttpError(
      response.status,
      rawText,
      cfg.model,
      durationMs,
      useSchema
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    console.error("[ai:gemini] invalid response body", {
      provider: "gemini",
      model: cfg.model,
      durationMs,
      httpStatus: response.status,
      errorType: "invalid_json",
      usedResponseSchema: useSchema,
    });
    throw new AppError(
      "AI returned an invalid response. Please try again.",
      502
    );
  }

  const text = extractGeminiText(body);
  if (!text.trim()) {
    console.error("[ai:gemini] empty content", {
      provider: "gemini",
      model: cfg.model,
      durationMs,
      httpStatus: response.status,
      errorType: "empty_content",
      usedResponseSchema: useSchema,
    });
    throw new AppError(
      "Unable to complete the AI request right now. Please try again.",
      502
    );
  }

  console.info("[ai:gemini] generateContent ok", {
    provider: "gemini",
    model: cfg.model,
    durationMs,
    httpStatus: response.status,
    usedResponseSchema: useSchema,
  });

  return {
    text,
    httpStatus: response.status,
    durationMs,
    model: cfg.model,
    usedResponseSchema: useSchema,
  };
}

function extractGeminiText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const record = body as { candidates?: GeminiCandidate[] };
  const parts = record.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function mapGeminiHttpError(
  status: number,
  rawText: string,
  model: string,
  durationMs: number,
  usedResponseSchema: boolean
): never {
  let message = "";
  let apiStatus = "";
  try {
    const parsed = JSON.parse(rawText) as GeminiErrorBody;
    message = (parsed.error?.message || "").toLowerCase();
    apiStatus = (parsed.error?.status || "").toLowerCase();
  } catch {
    message = "";
  }

  if (status === 401 || status === 403 || apiStatus.includes("permission")) {
    console.error("[ai:gemini] auth failure", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "authentication",
      usedResponseSchema,
    });
    throw new AppError(
      "AI provider authentication failed. Check GEMINI_API_KEY.",
      503
    );
  }

  if (
    status === 503 ||
    apiStatus === "unavailable" ||
    message.includes("high demand") ||
    message.includes("temporarily")
  ) {
    console.error("[ai:gemini] temporarily unavailable", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "unavailable",
      usedResponseSchema,
    });
    throw new AppError(
      "AI provider temporarily unavailable due to high demand. Please try again.",
      503
    );
  }

  if (status === 429 || message.includes("quota") || message.includes("rate")) {
    console.error("[ai:gemini] rate limited", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "rate_limit",
      usedResponseSchema,
    });
    throw new AppError(
      "AI rate limit reached. Please wait a moment and try again.",
      429
    );
  }

  if (
    status === 400 &&
    (message.includes("model") ||
      message.includes("not found") ||
      message.includes("not supported") ||
      message.includes("no longer available"))
  ) {
    console.error("[ai:gemini] invalid model", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "invalid_model",
      usedResponseSchema,
    });
    throw new AppError(
      "Configured AI model is not available. Check GEMINI_MODEL.",
      503
    );
  }

  if (status === 404) {
    console.error("[ai:gemini] invalid model", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "invalid_model",
      usedResponseSchema,
    });
    throw new AppError(
      "Configured AI model is not available. Check GEMINI_MODEL.",
      503
    );
  }

  if (status === 400) {
    console.error("[ai:gemini] bad request", {
      provider: "gemini",
      model,
      durationMs,
      httpStatus: status,
      errorType: "bad_request",
      usedResponseSchema,
    });
    throw new AppError(
      "Unable to analyze this lead right now. Please try again.",
      502
    );
  }

  console.error("[ai:gemini] provider failure", {
    provider: "gemini",
    model,
    durationMs,
    httpStatus: status,
    errorType: "provider_error",
    usedResponseSchema,
  });
  throw new AppError(
    "Unable to analyze this lead right now. Please try again.",
    502
  );
}
