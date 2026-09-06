import { existsSync, readFileSync } from "fs";
import {
  resolveEffectiveVoiceMode,
  getVoiceStreamUrl,
  createStreamToken,
} from "../src/lib/voice/mode";
import { buildConnectStreamTwiml } from "../src/lib/voice/twilio-client";
import { PrismaClient } from "@prisma/client";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

async function main() {
  const eff = resolveEffectiveVoiceMode();
  const stream = getVoiceStreamUrl();
  const webhook = (process.env.VOICE_WEBHOOK_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const fromPhone = (process.env.TWILIO_PHONE_NUMBER || "").trim();
  const token = createStreamToken();
  const twiml = buildConnectStreamTwiml({
    streamUrl: stream || "wss://invalid/media-stream",
    callId: "ready_check",
    streamToken: token,
  });

  const prisma = new PrismaClient();
  const leads = await prisma.lead.findMany({
    take: 5,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, companyName: true, phone: true },
  });
  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        effectiveMode: eff.mode,
        fallbackReason: eff.fallbackReason || null,
        webhookBase: webhook,
        streamUrl: stream,
        fromPhone,
        streamTokenLen: token.length,
        twimlHasConnect: twiml.includes("<Connect>"),
        twimlHasStream: twiml.includes("<Stream url="),
        twimlHasGather: twiml.includes("<Gather"),
        twimlHasCallId: twiml.includes('name="callId"'),
        twimlHasStreamToken: twiml.includes('name="streamToken"'),
        sampleLeads: leads.map((l) => ({
          name: l.name,
          company: l.companyName,
          phone: l.phone,
          isDemo555: /555/.test(l.phone || ""),
        })),
      },
      null,
      2
    )
  );
}

main();
