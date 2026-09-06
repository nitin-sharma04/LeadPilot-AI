import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { signupSchema } from "@/lib/validations";
import type { z } from "zod";

export async function registerUser(input: z.infer<typeof signupSchema>) {
  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same message as invalid login path where practical — avoid easy enumeration wording
    throw new AppError("Unable to create account with this email", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const companyName = input.companyName.trim();

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: companyName,
        industry: "General",
        description: `${companyName} workspace`,
        timezone: "UTC",
        isDemo: false,
        // Safe automation defaults (schema defaults also apply)
        emailHumanApprovalRequired: true,
        emailAutomationEnabled: false,
        emailAutoSendEnabled: false,
        leadAutoAnalyzeEnabled: true,
        leadAutoAssignEnabled: false,
        leadAutoFollowUpEnabled: false,
        leadAutoCallEnabled: false,
        leadAutoEmailEnabled: false,
        onboardingCompletedAt: null,
      },
    });

    const createdUser = await tx.user.create({
      data: {
        companyId: company.id,
        name: input.name.trim(),
        email,
        passwordHash,
        role: UserRole.OWNER,
      },
    });

    await tx.aIAgent.create({
      data: {
        companyId: company.id,
        name: "Alex",
        voice: "professional-female",
        tone: "consultative",
        greeting: `Hi, this is Alex from ${companyName} calling about your recent inquiry. Do you have a quick minute to chat?`,
        companyInformation: `${companyName} uses LeadPilot AI to qualify and convert inbound leads.`,
        qualificationQuestions: [
          "What service are you interested in?",
          "What is your approximate budget?",
          "When would you like to get started?",
          "Are you currently comparing other providers?",
        ],
      },
    });

    // Default follow-up sequence (empty steps ok — ensureDefaultSequence can enrich later)
    const sequence = await tx.followUpSequence.create({
      data: {
        companyId: company.id,
        name: "Default nurture",
        description: "Safe default sequence created at signup",
        isDefault: true,
        steps: {
          create: [
            {
              stepOrder: 1,
              delayDays: 0,
              subjectHint: "Thanks for reaching out",
              enabled: true,
            },
            {
              stepOrder: 2,
              delayDays: 3,
              subjectHint: "Quick follow-up",
              enabled: true,
            },
          ],
        },
      },
    });

    await tx.company.update({
      where: { id: company.id },
      data: {
        defaultLeadOwnerId: createdUser.id,
        defaultFollowUpSequenceId: sequence.id,
      },
    });

    return createdUser;
  });

  return user;
}
