/**
 * Lightweight offline checks for Phase 3 AI validation + scoring schema.
 * Run: npx tsx scripts/verify-ai-schema.ts
 */
import { leadAnalysisResultSchema } from "../src/types/ai";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const valid = leadAnalysisResultSchema.safeParse({
  score: 94,
  intent: "high",
  urgency: "high",
  estimatedBudget: "$5,000–$10,000",
  industry: "Healthcare",
  buyingStage: "ready_to_buy",
  requirements: ["Website redesign", "Online booking"],
  painPoints: ["Outdated website"],
  objections: [],
  recommendation: "Contact this lead immediately.",
  reasoning: "Clear requirement, budget, and deadline.",
});
assert(valid.success, "Expected valid analysis to pass");

const invalidScore = leadAnalysisResultSchema.safeParse({
  score: 150,
  intent: "high",
  urgency: "high",
  estimatedBudget: "unknown",
  industry: "General",
  buyingStage: "unknown",
  requirements: [],
  painPoints: [],
  objections: [],
  recommendation: "Nurture",
  reasoning: "Too high score",
});
assert(!invalidScore.success, "Expected invalid score to fail");

const malformed = leadAnalysisResultSchema.safeParse({
  score: "ninety",
  intent: "maybe",
});
assert(!malformed.success, "Expected malformed payload to fail");

console.log("AI schema verification passed.");
