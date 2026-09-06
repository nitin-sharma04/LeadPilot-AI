/**
 * Live Gemini + LeadPilot analysis smoke test.
 * Loads secrets from .env.local / .env. Never prints API keys.
 * Run: npx tsx scripts/live-gemini-test.ts
 */
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

const root = path.resolve(__dirname, "..");
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

process.env.AI_PROVIDER = "gemini";

async function main() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  console.log("Gemini env:", {
    keyPresent: Boolean(key),
    keyLength: key.length,
    model: process.env.GEMINI_MODEL || "(default gemini-flash-latest)",
    provider: process.env.AI_PROVIDER,
  });

  if (!key) {
    console.error(
      "No GEMINI_API_KEY in .env.local. Add it locally, then re-run this script."
    );
    process.exit(1);
  }

  const { geminiGenerateContent } = await import("../src/lib/ai/gemini-client");
  const { analyzeLead } = await import("../src/lib/ai/lead-analyzer");
  const { PrismaClient } = await import("@prisma/client");

  console.log("\n1) Raw Gemini generateContent smoke ...");
  const smoke = await geminiGenerateContent({
    systemPrompt:
      "You are a JSON API. Return only valid JSON matching the schema.",
    userPrompt:
      "Analyze a fictional low-intent B2B lead named Smoke Test at Example Co who asked a vague pricing question with no budget or timeline. Return the lead analysis JSON.",
  });
  console.log("Smoke OK:", {
    model: smoke.model,
    durationMs: smoke.durationMs,
    httpStatus: smoke.httpStatus,
    contentLength: smoke.text.length,
  });

  const prisma = new PrismaClient();
  try {
    console.log("\n2) Selecting seeded lead ...");
    const lead = await prisma.lead.findFirst({
      where: { email: "sarah.miller@apexdental.com" },
      orderBy: { createdAt: "desc" },
    });
    if (!lead) {
      throw new Error("Seeded lead Sarah Miller not found. Run npm run db:seed.");
    }
    console.log("Lead:", {
      id: lead.id,
      name: lead.name,
      priorScore: lead.score,
    });

    console.log("\n3) LeadPilot analyzeLead (Gemini + Zod) ...");
    const started = Date.now();
    const { result, provider, model } = await analyzeLead({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName,
      jobTitle: lead.jobTitle,
      industry: lead.industry,
      source: lead.source,
      message: lead.message,
      budget: lead.budget,
      timeline: lead.timeline,
      dealValue: lead.dealValue,
    });
    console.log("Analysis OK in", Date.now() - started, "ms", {
      provider,
      model,
      score: result.score,
      intent: result.intent,
      urgency: result.urgency,
    });

    console.log("\n4) Persist LeadAnalysis + Activity ...");
    const intentLabel =
      result.intent.charAt(0).toUpperCase() + result.intent.slice(1);
    const urgencyLabel =
      result.urgency.charAt(0).toUpperCase() + result.urgency.slice(1);

    const [analysis] = await prisma.$transaction([
      prisma.leadAnalysis.upsert({
        where: { leadId: lead.id },
        create: {
          leadId: lead.id,
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          estimatedBudget: result.estimatedBudget,
          industry: result.industry,
          buyingStage: result.buyingStage,
          requirements: result.requirements,
          painPoints: result.painPoints,
          objections: result.objections,
          recommendation: result.recommendation,
          reasoning: result.reasoning,
          source: provider,
        },
        update: {
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          estimatedBudget: result.estimatedBudget,
          industry: result.industry,
          buyingStage: result.buyingStage,
          requirements: result.requirements,
          painPoints: result.painPoints,
          objections: result.objections,
          recommendation: result.recommendation,
          reasoning: result.reasoning,
          source: provider,
        },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          score: result.score,
          intent: intentLabel,
          urgency: urgencyLabel,
          industry:
            result.industry !== "unknown" ? result.industry : lead.industry,
        },
      }),
      prisma.activity.create({
        data: {
          companyId: lead.companyId,
          leadId: lead.id,
          type: "AI_ANALYSIS",
          description: `AI analyzed lead and assigned a score of ${result.score}.`,
        },
      }),
    ]);

    const refreshed = await prisma.lead.findUnique({
      where: { id: lead.id },
      include: { analysis: true },
    });

    console.log("Persist OK:", {
      analysisId: analysis.id,
      source: analysis.source,
      leadScore: refreshed?.score,
      analysisScore: refreshed?.analysis?.score,
      intent: refreshed?.intent,
      urgency: refreshed?.urgency,
    });

    console.log("\nLIVE GEMINI TEST PASSED");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error("\nLIVE GEMINI TEST FAILED:", msg);
  process.exit(1);
});
