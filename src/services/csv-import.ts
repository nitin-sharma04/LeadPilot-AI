/**
 * CSV lead import (server-side validation + preview + commit).
 */

import { LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { createLeadRecord } from "@/services/leads";
import type { SessionUser } from "@/lib/session";

export type CsvMapping = {
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  message?: string;
  website?: string;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

export function previewCsvImport(text: string) {
  if (text.length > 2_000_000) {
    throw new AppError("CSV too large (max ~2MB)", 400);
  }
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new AppError("CSV needs a header row and at least one data row", 400);
  }
  const headers = rows[0];
  const data = rows.slice(1, 51);
  return {
    headers,
    previewRows: data,
    totalRows: rows.length - 1,
  };
}

export async function commitCsvImport(input: {
  user: SessionUser;
  filename: string;
  csvText: string;
  mapping: CsvMapping;
}) {
  const { headers, totalRows } = previewCsvImport(input.csvText);
  const rows = parseCsv(input.csvText).slice(1);

  const col = (key: keyof CsvMapping) => {
    const name = input.mapping[key];
    if (!name) return -1;
    return headers.findIndex((h) => h === name);
  };
  const idx = {
    name: col("name"),
    email: col("email"),
    phone: col("phone"),
    companyName: col("companyName"),
    message: col("message"),
    website: col("website"),
  };
  if (idx.name < 0 || idx.email < 0) {
    throw new AppError("Mapping must include name and email columns", 400);
  }

  const record = await prisma.leadImport.create({
    data: {
      companyId: input.user.companyId,
      userId: input.user.id,
      filename: input.filename.slice(0, 200),
      totalRows,
      status: "PROCESSING",
      mappingJson: JSON.stringify(input.mapping),
    },
  });

  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const email = (r[idx.email] || "").trim();
    const name = (r[idx.name] || "").trim();
    if (!email || !email.includes("@") || !name) {
      failed += 1;
      if (errors.length < 10) errors.push(`Row ${i + 2}: invalid name/email`);
      continue;
    }
    try {
      const result = await createLeadRecord({
        companyId: input.user.companyId,
        name,
        email,
        phone: idx.phone >= 0 ? r[idx.phone] : null,
        companyName:
          idx.companyName >= 0 && r[idx.companyName]
            ? r[idx.companyName]
            : "Unknown",
        message: idx.message >= 0 ? r[idx.message] : null,
        website: idx.website >= 0 ? r[idx.website] : null,
        source: LeadSource.CSV,
        actorUserId: input.user.id,
        actorName: input.user.name,
        activityType: "LEAD_IMPORTED",
        activityDescription: `Imported from CSV (${input.filename})`,
        runAutomation: i < 20, // avoid bursting AI for huge files
      });
      if (result.created) imported += 1;
      else duplicates += 1;
    } catch (e) {
      failed += 1;
      if (errors.length < 10) {
        errors.push(
          `Row ${i + 2}: ${e instanceof Error ? e.message : "failed"}`
        );
      }
    }
  }

  const updated = await prisma.leadImport.update({
    where: { id: record.id },
    data: {
      importedRows: imported,
      duplicateRows: duplicates,
      failedRows: failed,
      status: "COMPLETED",
      completedAt: new Date(),
      errorSummary: errors.join("; ").slice(0, 2000) || null,
    },
  });

  return {
    id: updated.id,
    totalRows,
    importedRows: imported,
    duplicateRows: duplicates,
    failedRows: failed,
    status: updated.status,
    errorSummary: updated.errorSummary,
  };
}

export async function listLeadImports(user: SessionUser) {
  const rows = await prisma.leadImport.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    totalRows: r.totalRows,
    importedRows: r.importedRows,
    duplicateRows: r.duplicateRows,
    failedRows: r.failedRows,
    status: r.status,
    errorSummary: r.errorSummary,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}
