import { AppError } from "@/lib/errors";

export type ExperientialLabsConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Docs-confirmed platform promotional model (Quickstart / Overview). */
export const EXPLABS_DEFAULT_MODEL = "qwen3.8-27b";
export const EXPLABS_DEFAULT_BASE_URL = "https://api.experientiallabs.ai";

export function getExperientialLabsConfig(): ExperientialLabsConfig {
  const apiKey = process.env.EXPLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(
      "AI analysis is not configured. Set EXPLABS_API_KEY on the server.",
      503
    );
  }

  const baseUrl = (
    process.env.EXPLABS_BASE_URL?.trim() || EXPLABS_DEFAULT_BASE_URL
  ).replace(/\/$/, "");

  const model = process.env.EXPLABS_MODEL?.trim() || EXPLABS_DEFAULT_MODEL;

  return { apiKey, baseUrl, model };
}

export type WhoAmIResult = {
  ok: true;
  organizationId?: string;
  organizationName?: string;
  rawKeys: string[];
};

/**
 * Verifies EXPLABS_API_KEY via documented management endpoint:
 * GET {baseUrl}/api/whoami
 * Never returns the API key or Authorization header.
 */
export async function verifyExperientialLabsKey(
  config?: ExperientialLabsConfig
): Promise<WhoAmIResult> {
  const cfg = config ?? getExperientialLabsConfig();
  const url = `${cfg.baseUrl}/api/whoami`;
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    console.error("[ai:experiential-labs] whoami network failure", {
      provider: "experiential-labs",
      durationMs: Date.now() - started,
      errorType: "network",
    });
    throw new AppError(
      "Unable to reach the AI provider. Please try again.",
      502
    );
  }

  const durationMs = Date.now() - started;

  if (response.status === 401 || response.status === 403) {
    console.error("[ai:experiential-labs] whoami auth failure", {
      provider: "experiential-labs",
      httpStatus: response.status,
      durationMs,
      errorType: "authentication",
    });
    throw new AppError(
      "AI provider authentication failed. Check EXPLABS_API_KEY.",
      503
    );
  }

  if (!response.ok) {
    console.error("[ai:experiential-labs] whoami unexpected status", {
      provider: "experiential-labs",
      httpStatus: response.status,
      durationMs,
      errorType: "provider_error",
    });
    throw new AppError(
      "Unable to verify AI provider configuration. Please try again.",
      502
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  const organizationId =
    (typeof record.organization_id === "string" && record.organization_id) ||
    (typeof record.org_id === "string" && record.org_id) ||
    (typeof record.id === "string" && record.id) ||
    undefined;

  const organizationName =
    (typeof record.organization_name === "string" &&
      record.organization_name) ||
    (typeof record.name === "string" && record.name) ||
    (typeof record.org_name === "string" && record.org_name) ||
    undefined;

  console.info("[ai:experiential-labs] whoami ok", {
    provider: "experiential-labs",
    httpStatus: response.status,
    durationMs,
    hasOrgId: Boolean(organizationId),
  });

  return {
    ok: true,
    organizationId,
    organizationName,
    rawKeys: Object.keys(record),
  };
}
