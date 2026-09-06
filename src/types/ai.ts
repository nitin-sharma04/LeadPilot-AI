import { z } from "zod";

export const buyingStageSchema = z.enum([
  "researching",
  "evaluating",
  "ready_to_buy",
  "unknown",
]);

export const intentLevelSchema = z.enum(["low", "medium", "high"]);
export const urgencyLevelSchema = z.enum(["low", "medium", "high"]);

export const leadAnalysisResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  intent: intentLevelSchema,
  urgency: urgencyLevelSchema,
  estimatedBudget: z.string().min(1).max(200),
  industry: z.string().min(1).max(120),
  buyingStage: buyingStageSchema,
  requirements: z.array(z.string().min(1).max(200)).max(12),
  painPoints: z.array(z.string().min(1).max(200)).max(12),
  objections: z.array(z.string().min(1).max(200)).max(12),
  recommendation: z.string().min(1).max(500),
  reasoning: z.string().min(1).max(2000),
});

export type LeadAnalysisResult = z.infer<typeof leadAnalysisResultSchema>;
export type BuyingStage = z.infer<typeof buyingStageSchema>;
export type IntentLevel = z.infer<typeof intentLevelSchema>;
export type UrgencyLevel = z.infer<typeof urgencyLevelSchema>;

export type AIAnalysisStatus =
  | "idle"
  | "analyzing"
  | "success"
  | "error";

export type LeadAnalysisSource =
  | "seed"
  | "gemini"
  | "openai"
  | "experiential-labs"
  | "live";

export const analyzeLeadRequestSchema = z.object({
  leadId: z.string().cuid(),
});

export function titleCaseLevel(level: string): string {
  if (!level) return "—";
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();
}

export function formatBuyingStage(stage: string | null | undefined): string {
  if (!stage || stage === "unknown") return "Unknown";
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatAnalysisProviderLabel(
  source: string | null | undefined
): string {
  if (!source || source === "seed") return "Seeded demo analysis";
  if (source === "gemini") return "AI Provider: Gemini";
  if (source === "experiential-labs") return "AI Provider: Experiential Labs";
  if (source === "openai") return "AI Provider: OpenAI";
  if (source === "live") return "Live AI analysis";
  return "Live AI analysis";
}

export function isLiveAnalysisSource(source: string | null | undefined): boolean {
  return (
    source === "gemini" ||
    source === "experiential-labs" ||
    source === "openai" ||
    source === "live"
  );
}
