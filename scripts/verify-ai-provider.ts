/**
 * Offline (+ optional live) verification for Gemini provider wiring.
 * Run: npx tsx scripts/verify-ai-provider.ts
 * Never prints API keys.
 */
import { leadAnalysisResultSchema } from "../src/types/ai";
import { resolveAIProviderId } from "../src/lib/ai/provider-factory";
import {
  GEMINI_DEFAULT_MODEL,
  getGeminiConfig,
  geminiGenerateContent,
} from "../src/lib/ai/gemini-client";
import { createGeminiProvider } from "../src/lib/ai/providers/gemini";
import { AppError } from "../src/lib/errors";
import {
  LEAD_ANALYSIS_SYSTEM_PROMPT,
  buildLeadAnalysisUserPrompt,
} from "../src/lib/ai/prompts/lead-analysis";
import fs from "fs";
import path from "path";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, message: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function main() {
  assert(resolveAIProviderId(undefined) === "gemini", "Default provider should be gemini");
  assert(resolveAIProviderId("gemini") === "gemini", "gemini should resolve");
  assert(resolveAIProviderId("openai") === "openai", "openai should resolve");
  assert(
    resolveAIProviderId("experiential-labs") === "experiential-labs",
    "experiential-labs should resolve"
  );

  const prevKey = process.env.GEMINI_API_KEY;
  const prevModel = process.env.GEMINI_MODEL;

  process.env.GEMINI_API_KEY = "test_dummy_key_for_config_only";
  delete process.env.GEMINI_MODEL;
  const cfg = getGeminiConfig();
  assert(cfg.model === GEMINI_DEFAULT_MODEL, "Unexpected default Gemini model");

  delete process.env.GEMINI_API_KEY;
  assertThrows(() => getGeminiConfig(), "Missing GEMINI_API_KEY should throw");

  const malformed = leadAnalysisResultSchema.safeParse({
    score: "x",
    intent: "nope",
  });
  assert(!malformed.success, "Malformed analysis should fail Zod");

  const valid = leadAnalysisResultSchema.safeParse({
    score: 88,
    intent: "high",
    urgency: "medium",
    estimatedBudget: "unknown",
    industry: "Healthcare",
    buyingStage: "evaluating",
    requirements: ["Website"],
    painPoints: ["Outdated site"],
    objections: [],
    recommendation: "Book a discovery call.",
    reasoning: "Clear requirement with moderate commercial detail.",
  });
  assert(valid.success, "Valid analysis should pass Zod");

  if (prevKey) process.env.GEMINI_API_KEY = prevKey;
  else delete process.env.GEMINI_API_KEY;
  if (prevModel) process.env.GEMINI_MODEL = prevModel;
  else delete process.env.GEMINI_MODEL;

  const prompt = buildLeadAnalysisUserPrompt({
    name: "Test",
    email: "test@example.com",
    companyName: "Acme",
    source: "WEBSITE",
    message: "Need a website",
  });
  assert(!/AIza|AQ\./i.test(prompt), "Prompt must not contain API keys");
  assert(
    LEAD_ANALYSIS_SYSTEM_PROMPT.includes("Return ONLY valid JSON"),
    "System prompt missing JSON instruction"
  );

  process.env.GEMINI_API_KEY = "test_dummy_key_for_config_only";
  const provider = createGeminiProvider();
  assert(provider.id === "gemini", "Provider id mismatch");
  assert(provider.displayName === "Gemini", "Provider display name mismatch");

  console.log("Offline AI provider verification passed.");

  const liveKey = prevKey?.trim();
  if (liveKey && liveKey !== "test_dummy_key_for_config_only") {
    process.env.GEMINI_API_KEY = liveKey;
    process.env.AI_PROVIDER = "gemini";
    try {
      const result = await geminiGenerateContent({
        systemPrompt: "Return only JSON.",
        userPrompt:
          'Return exactly: {"score":50,"intent":"medium","urgency":"low","estimatedBudget":"unknown","industry":"unknown","buyingStage":"unknown","requirements":[],"painPoints":[],"objections":[],"recommendation":"Nurture.","reasoning":"Smoke test."}',
      });
      console.log("Live Gemini generateContent succeeded.", {
        model: result.model,
        durationMs: result.durationMs,
        httpStatus: result.httpStatus,
        contentLength: result.text.length,
      });
    } catch (error) {
      const message =
        error instanceof AppError ? error.message : "Gemini live call failed";
      console.error("Live Gemini verification failed:", message);
      process.exitCode = 1;
    }
  } else {
    console.log(
      "Skipping live Gemini call — set GEMINI_API_KEY in .env.local to run it."
    );
  }

  if (!prevKey) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevKey;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
