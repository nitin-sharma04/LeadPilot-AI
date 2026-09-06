import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { requireOwnerOrAdmin } from "@/lib/permissions";

export const runtime = "nodejs";

const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
] as const;

export async function GET() {
  try {
    const user = await requireSession();
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        id: true,
        name: true,
        industry: true,
        website: true,
        timezone: true,
        isDemo: true,
        onboardingCompletedAt: true,
      },
    });
    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, role: true, image: true },
    });
    return Response.json({
      data: {
        company,
        profile,
        timezones: TIMEZONES,
      },
    });
  } catch (error) {
    return jsonError(error, "Unable to load workspace settings", 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = z
      .object({
        companyName: z.string().min(2).max(120).optional(),
        industry: z.string().max(120).nullable().optional(),
        website: z.string().max(300).nullable().optional(),
        timezone: z.string().min(2).max(64).optional(),
        userName: z.string().min(2).max(120).optional(),
        completeOnboarding: z.boolean().optional(),
      })
      .parse(await request.json());

    if (
      body.companyName !== undefined ||
      body.industry !== undefined ||
      body.website !== undefined ||
      body.timezone !== undefined ||
      body.completeOnboarding
    ) {
      requireOwnerOrAdmin(user);
    }

    if (body.userName !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: body.userName.trim() },
      });
    }

    const companyData: Record<string, unknown> = {};
    if (body.companyName !== undefined)
      companyData.name = body.companyName.trim();
    if (body.industry !== undefined)
      companyData.industry = body.industry?.trim() || null;
    if (body.website !== undefined)
      companyData.website = body.website?.trim() || null;
    if (body.timezone !== undefined) companyData.timezone = body.timezone;
    if (body.completeOnboarding) {
      companyData.onboardingCompletedAt = new Date();
    }

    let company = null;
    if (Object.keys(companyData).length) {
      company = await prisma.company.update({
        where: { id: user.companyId },
        data: companyData,
        select: {
          id: true,
          name: true,
          industry: true,
          website: true,
          timezone: true,
          isDemo: true,
          onboardingCompletedAt: true,
        },
      });
    }

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, role: true },
    });

    return Response.json({ data: { company, profile } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Unable to update settings", 500);
  }
}
