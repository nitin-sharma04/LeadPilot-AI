import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { AppError, jsonError } from "@/lib/errors";
import {
  commitCsvImport,
  listLeadImports,
  previewCsvImport,
} from "@/services/csv-import";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await listLeadImports(user);
    return Response.json({ data });
  } catch (error) {
    return jsonError(error, "Unable to list imports", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const action = body.action as string;

    if (action === "preview") {
      const parsed = z
        .object({ csvText: z.string().min(1).max(2_000_000) })
        .parse(body);
      return Response.json({ data: previewCsvImport(parsed.csvText) });
    }

    if (action === "commit") {
      const parsed = z
        .object({
          csvText: z.string().min(1).max(2_000_000),
          filename: z.string().min(1).max(200),
          mapping: z.object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            companyName: z.string().optional(),
            message: z.string().optional(),
            website: z.string().optional(),
          }),
        })
        .parse(body);
      const data = await commitCsvImport({
        user,
        filename: parsed.filename,
        csvText: parsed.csvText,
        mapping: parsed.mapping,
      });
      return Response.json({ data }, { status: 201 });
    }

    throw new AppError("action must be preview or commit", 400);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(new AppError(error.issues[0]?.message || "Invalid", 400));
    }
    return jsonError(error, "CSV import failed", 500);
  }
}
