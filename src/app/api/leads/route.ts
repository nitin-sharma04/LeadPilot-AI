import { NextRequest } from "next/server";
import { LeadSource, LeadStatus } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { createLeadSchema } from "@/lib/validations";
import { createLead, listLeads } from "@/services/leads";
import { jsonError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession();
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get("status");
    const sourceParam = searchParams.get("source");

    let status: LeadStatus | "ALL" | "HOT" | undefined = "ALL";
    if (statusParam && statusParam !== "all") {
      if (statusParam === "hot") status = "HOT";
      else status = statusParam.toUpperCase() as LeadStatus;
    }

    const leads = await listLeads(user, {
      q: searchParams.get("q") ?? undefined,
      status,
      source:
        sourceParam && sourceParam !== "all"
          ? (sourceParam.toUpperCase() as LeadSource)
          : "ALL",
      score: (searchParams.get("score") as "all" | "hot" | "warm" | "cold") ?? "all",
    });

    return Response.json({ data: leads });
  } catch (error) {
    return jsonError(error, "Unable to load leads", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid lead data" },
        { status: 400 }
      );
    }

    const lead = await createLead(user, parsed.data);
    return Response.json({ data: lead }, { status: 201 });
  } catch (error) {
    return jsonError(error, "Unable to create lead", 500);
  }
}
