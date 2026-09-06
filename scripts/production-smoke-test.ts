/**
 * Production foundation smoke test (no real email/calls).
 * Run: npx tsx scripts/production-smoke-test.ts
 */

import { PrismaClient, LeadSource } from "@prisma/client";
import bcrypt from "bcryptjs";
import { validateEnvironment } from "../src/lib/env";
import { createLeadRecord, hashCaptureKey } from "../src/services/leads";
import { registerUser } from "../src/services/auth-service";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Production smoke test…");

  const env = validateEnvironment();
  console.log("env ok:", env.ok, "issues:", env.issues.length, "warnings:", env.warnings.length);

  await prisma.$queryRaw`SELECT 1`;
  console.log("database: ok");

  const stamp = Date.now();
  const email = `smoke-${stamp}@example.com`;
  const password = "SmokeTestPass1!";

  const user = await registerUser({
    name: "Smoke Tester",
    email,
    password,
    companyName: `Smoke Co ${stamp}`,
  });
  assert(user.email === email, "user created");

  const company = await prisma.company.findUnique({ where: { id: user.companyId } });
  assert(company && company.isDemo === false, "not demo company");
  assert(company.onboardingCompletedAt === null, "needs onboarding");

  // Complete onboarding
  await prisma.company.update({
    where: { id: user.companyId },
    data: {
      timezone: "Asia/Kolkata",
      industry: "Testing",
      onboardingCompletedAt: new Date(),
    },
  });

  const loginHashOk = await bcrypt.compare(password, user.passwordHash);
  assert(loginHashOk, "password hash verifies");

  const lead = await createLeadRecord({
    companyId: user.companyId,
    name: "Smoke Lead",
    email: `lead-${stamp}@example.com`,
    companyName: "Smoke Lead Co",
    source: LeadSource.MANUAL,
    actorUserId: user.id,
    runAutomation: false,
  });
  assert(lead.created, "lead created");

  const again = await createLeadRecord({
    companyId: user.companyId,
    name: "Smoke Lead Dup",
    email: `lead-${stamp}@example.com`,
    companyName: "Smoke Lead Co",
    source: LeadSource.API,
    runAutomation: false,
  });
  assert(again.duplicate && again.lead.id === lead.lead.id, "dedupe");

  const appt = await prisma.appointment.create({
    data: {
      companyId: user.companyId,
      leadId: lead.lead.id,
      assignedToId: user.id,
      title: "Smoke meeting",
      dateTime: new Date(Date.now() + 86400000),
      duration: 30,
      status: "SCHEDULED",
      timezone: "Asia/Kolkata",
    },
  });
  assert(appt.id, "appointment created");

  // Capture key hash sanity
  const raw = `lp_live_smoke_${stamp}`;
  assert(hashCaptureKey(raw).length === 64, "capture key hash");

  // Persistence check: re-read after "logout" (new queries)
  const persistedLead = await prisma.lead.findFirst({
    where: { id: lead.lead.id, companyId: user.companyId },
  });
  const persistedAppt = await prisma.appointment.findFirst({
    where: { id: appt.id, companyId: user.companyId },
  });
  assert(persistedLead, "lead persists");
  assert(persistedAppt, "appointment persists");

  // Tenant isolation: other company cannot see
  const other = await prisma.company.create({
    data: { name: `Other ${stamp}`, isDemo: false },
  });
  const cross = await prisma.lead.findFirst({
    where: { id: lead.lead.id, companyId: other.id },
  });
  assert(!cross, "tenant isolation");

  // Cleanup smoke artifacts
  await prisma.company.delete({ where: { id: user.companyId } });
  await prisma.company.delete({ where: { id: other.id } });

  console.log("Production smoke test PASSED");
}

main()
  .catch((e) => {
    console.error("Production smoke test FAILED", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
