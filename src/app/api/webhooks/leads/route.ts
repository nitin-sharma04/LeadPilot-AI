import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { LeadSource } from "@prisma/client";
import { AppError, jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createLeadRecord } from "@/services/leads";
import {
  checkCaptureRateLimit,
  resolveCompanyFromCaptureKey,
} from "@/services/lead-capture-keys";

export const runtime = "nodejs";

const bodySchema = z.object({
  eventId: z.string().min(4).max(200),
  source: z.string().min(2).max(64).default("webhook"),
  timestamp: z.number().optional(),
  lead: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(40).optional(),
    company: z.string().max(200).optional(),
    message: z.string().max(4000).optional(),
  }),
});

function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization") || "";
    const rawKey = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : request.headers.get("x-leadpilot-key")?.trim();
    if (!rawKey) throw new AppError("Missing capture API key", 401);

    if (!checkCaptureRateLimit(`webhook:${rawKey.slice(0, 24)}`, 120)) {
      throw new AppError("Rate limit exceeded", 429);
    }

    const resolved = await resolveCompanyFromCaptureKey(rawKey);
    if (!resolved) throw new AppError("Invalid or revoked API key", 401);

    const rawBody = await request.text();
    if (rawBody.length > 100_000) {
      throw new AppError("Payload too large", 413);
    }

    const webhookSecret = process.env.LEAD_WEBHOOK_SECRET?.trim();
    if (webhookSecret) {
      const sig =
        request.headers.get("x-leadpilot-signature") ||
        request.headers.get("x-signature");
      if (!verifySignature(rawBody, sig, webhookSecret)) {
        throw new AppError("Invalid webhook signature", 401);
      }
    }

    const body = bodySchema.parse(JSON.parse(rawBody));

    // Replay protection
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: {
        companyId_eventId: {
          companyId: resolved.companyId,
          eventId: body.eventId,
        },
      },
    });
    if (existingEvent) {
      return Response.json({
        data: {
          replay: true,
          eventId: body.eventId,
          leadId: existingEvent.leadId,
        },
      });
    }

    const result = await createLeadRecord({
      companyId: resolved.companyId,
      name: body.lead.name,
      email: body.lead.email,
      phone: body.lead.phone,
      companyName: body.lead.company || "Unknown",
      message: body.lead.message,
      source: LeadSource.API,
      activityType: "LEAD_CAPTURED",
      activityDescription: `Lead captured via webhook (${body.source})`,
      runAutomation: true,
    });

    await prisma.webhookEvent.create({
      data: {
        companyId: resolved.companyId,
        eventId: body.eventId,
        source: body.source,
        leadId: result.lead.id,
      },
    });

    return Response.json(
      {
        data: {
          replay: false,
          eventId: body.eventId,
          leadId: result.lead.id,
          created: result.created,
          duplicate: result.duplicate,
        },
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "Webhook processing failed", 500);
  }
}
