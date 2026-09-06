/**
 * Live Experiential Labs smoke test.
 * Loads EXPLABS_* from .env.local or .env without printing secrets.
 */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
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
    out[k] = v;
  }
  return out;
}

const root = path.resolve(__dirname, "..");
const merged = {
  ...loadEnvFile(path.join(root, ".env")),
  ...loadEnvFile(path.join(root, ".env.local")),
};

for (const [k, v] of Object.entries(merged)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

process.env.AI_PROVIDER = process.env.AI_PROVIDER || "experiential-labs";

const key = (process.env.EXPLABS_API_KEY || "").trim();
console.log("Key loaded:", {
  length: key.length,
  startsWithXpl: key.startsWith("xpl_"),
  isPlaceholder:
    key.includes("your_real_key") || key === "xpl_your_real_key" || !key,
  model: process.env.EXPLABS_MODEL || "(default)",
  baseUrl: process.env.EXPLABS_BASE_URL || "(default)",
});

if (!key || key.includes("your_real_key")) {
  console.error(
    "No real EXPLABS_API_KEY found. Put your key in .env.local as EXPLABS_API_KEY=xpl_..."
  );
  process.exit(1);
}

async function main() {
  const { verifyExperientialLabsKey } =
    await import("../src/lib/ai/experiential-labs-client.ts");
  const { analyzeLead } = await import("../src/lib/ai/lead-analyzer.ts");
  const { PrismaClient } = await import("@prisma/client");

  console.log("\n1) Verifying GET /api/whoami ...");
  const whoami = await verifyExperientialLabsKey();
  console.log("whoami OK:", {
    hasOrgId: Boolean(whoami.organizationId),
    hasOrgName: Boolean(whoami.organizationName),
    responseKeys: whoami.rawKeys,
  });

  const prisma = new PrismaClient();
  try {
    console.log("\n2) Selecting a seeded lead for analysis ...");
    const lead = await prisma.lead.findFirst({
      where: { email: "sarah.miller@apexdental.com" },
      orderBy: { createdAt: "desc" },
    });

    if (!lead) {
      throw new Error("Seeded lead Sarah Miller not found. Run npm run db:seed.");
    }

    console.log("Lead selected:", {
      id: lead.id,
      name: lead.name,
      company: lead.companyName,
      priorScore: lead.score,
    });

    console.log("\n3) Calling Experiential Labs lead analysis ...");
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
      buyingStage: result.buyingStage,
      estimatedBudget: result.estimatedBudget,
      requirementsCount: result.requirements.length,
    });

    console.log("\n4) Persisting analysis via Prisma upsert ...");
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

    console.log("\nLIVE TEST PASSED");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error("\nLIVE TEST FAILED:", msg);
  process.exit(1);
});
