/**
 * Live Phase 4 sales-response generation smoke test.
 * Loads .env / .env.local. Never prints API keys.
 * Run: npx tsx scripts/live-sales-response-test.ts
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
process.env.AI_PROVIDER = process.env.AI_PROVIDER || "gemini";

async function main() {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  console.log("Env:", {
    provider: process.env.AI_PROVIDER,
    geminiKeyPresent: Boolean(key),
    model: process.env.GEMINI_MODEL || "(default)",
  });
  if (!key) {
    console.error("Missing GEMINI_API_KEY in .env.local");
    process.exit(1);
  }

  const { PrismaClient } = await import("@prisma/client");
  const { generateAndPersistSalesResponse } = await import(
    "../src/services/ai-sales-response"
  );

  const prisma = new PrismaClient();
  try {
    const lead = await prisma.lead.findFirst({
      where: { email: "sarah.miller@apexdental.com" },
      include: { analysis: true },
      orderBy: { createdAt: "desc" },
    });
    if (!lead) throw new Error("Seeded Sarah Miller lead not found");
    if (!lead.analysis) {
      throw new Error("Lead has no analysis — run Phase 3 analysis first");
    }

    const user = await prisma.user.findFirst({
      where: { companyId: lead.companyId },
      orderBy: { createdAt: "asc" },
    });
    if (!user) throw new Error("No user found for company");

    console.log("Generating sales response for", lead.name, "...");
    const created = await generateAndPersistSalesResponse(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      },
      {
        leadId: lead.id,
        responseType: "initial_outreach",
        tone: "professional",
        channel: "email",
      }
    );

    console.log("Created:", {
      id: created.id,
      channel: created.channel,
      responseType: created.responseType,
      provider: created.provider,
      model: created.model,
      subjectLen: created.subject?.length ?? 0,
      bodyLen: created.body.length,
      ctaLen: created.callToAction.length,
    });

    const count = await prisma.generatedResponse.count({
      where: { leadId: lead.id, companyId: lead.companyId },
    });
    const activity = await prisma.activity.findFirst({
      where: { leadId: lead.id, type: "AI_SALES_RESPONSE" },
      orderBy: { createdAt: "desc" },
    });

    console.log("Persist checks:", {
      responseCount: count,
      activityPresent: Boolean(activity),
    });

    console.log("\nLIVE SALES RESPONSE TEST PASSED");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\nLIVE SALES RESPONSE TEST FAILED:", err?.message || err);
  process.exit(1);
});
