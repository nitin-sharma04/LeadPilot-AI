import { NextRequest } from "next/server";
import { z } from "zod";
import { LeadSource } from "@prisma/client";
import { AppError, jsonError } from "@/lib/errors";
import { createLeadRecord } from "@/services/leads";
import {
  checkCaptureRateLimit,
  resolveCompanyFromCaptureKey,
} from "@/services/lead-capture-keys";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional(),
  company: z.string().max(200).optional(),
  companyName: z.string().max(200).optional(),
  website: z.string().max(300).optional(),
  message: z.string().max(4000).optional(),
  source: z
    .enum(["WEB_FORM", "API", "OTHER", "WEBSITE"])
    .optional()
    .default("API"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function extractKey(request: NextRequest): string | null {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-leadpilot-key")?.trim() || null;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  const origin = process.env.LEAD_CAPTURE_CORS_ORIGIN?.trim() || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-LeadPilot-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export async function POST(request: NextRequest) {
  try {
    const rawKey = extractKey(request);
    if (!rawKey) throw new AppError("Missing capture API key", 401);

    if (!checkCaptureRateLimit(`capture:${rawKey.slice(0, 24)}`)) {
      throw new AppError("Rate limit exceeded. Try again shortly.", 429);
    }

    const resolved = await resolveCompanyFromCaptureKey(rawKey);
    if (!resolved) throw new AppError("Invalid or revoked API key", 401);

    const json = await request.json();
    const body = bodySchema.parse(json);

    // Never accept companyId / ownerId / score from client
    if (
      json &&
      typeof json === "object" &&
      ("companyId" in json || "score" in json || "assignedToId" in json)
    ) {
      throw new AppError("Invalid fields in payload", 400);
    }

    const sourceMap: Record<string, LeadSource> = {
      WEB_FORM: LeadSource.WEB_FORM,
      API: LeadSource.API,
      OTHER: LeadSource.OTHER,
      WEBSITE: LeadSource.WEBSITE,
    };

    const result = await createLeadRecord({
      companyId: resolved.companyId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      companyName: body.companyName || body.company || "Unknown",
      website: body.website,
      message: body.message,
      source: sourceMap[body.source] || LeadSource.API,
      metadata: body.metadata,
      activityType: "LEAD_CAPTURED",
      activityDescription: `Lead captured via public API (${body.source})`,
      runAutomation: true,
    });

    return Response.json(
      {
        data: {
          id: result.lead.id,
          created: result.created,
          duplicate: result.duplicate,
          name: result.lead.name,
          email: result.lead.email,
        },
      },
      {
        status: result.created ? 201 : 200,
        headers: corsHeaders(),
      }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        new AppError(error.issues[0]?.message || "Invalid", 400),
        "Invalid lead payload",
        400
      );
    }
    const res = jsonError(error, "Unable to capture lead", 500);
    const headers = corsHeaders();
    Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }
}
