import { mapSourceToDb } from "@/lib/mappers";
import type { Lead, LeadSource } from "@/types";

export type AddLeadResult =
  | { ok: true; lead: Lead }
  | { ok: false; error: string; existingLeadId?: string; status: number };

export type DashboardLeadFormInput = {
  name: string;
  company: string;
  email: string;
  phone?: string;
  source: LeadSource;
  dealValue: number | string;
  message?: string;
};

export function buildDashboardLeadCreateBody(input: DashboardLeadFormInput) {
  const phone = input.phone?.trim();
  const message = input.message?.trim();
  const dealValue = Math.trunc(Math.max(0, Number(input.dealValue) || 0));

  return {
    name: input.name.trim(),
    companyName: input.company.trim(),
    email: input.email.trim().toLowerCase(),
    ...(phone ? { phone } : {}),
    source: mapSourceToDb(input.source),
    dealValue,
    ...(message ? { message } : {}),
  };
}

function readErrorMessage(json: unknown, fallback: string) {
  if (
    json &&
    typeof json === "object" &&
    "error" in json &&
    typeof json.error === "string" &&
    json.error.trim()
  ) {
    return json.error;
  }
  return fallback;
}

function isCreatedLead(value: unknown): value is Lead {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof (value as { id: unknown }).id === "string" &&
      (value as { id: string }).id.trim().length > 0
  );
}

export function interpretLeadCreateResponse(input: {
  ok: boolean;
  status: number;
  json: unknown;
}): AddLeadResult {
  const { ok, status, json } = input;

  if (status === 409) {
    const existingLeadId =
      json &&
      typeof json === "object" &&
      "existingLeadId" in json &&
      typeof json.existingLeadId === "string" &&
      json.existingLeadId.trim()
        ? json.existingLeadId
        : undefined;
    return {
      ok: false,
      status,
      existingLeadId,
      error: "This lead already exists in your workspace.",
    };
  }

  if (!ok) {
    return {
      ok: false,
      status,
      error: readErrorMessage(json, "Unable to create lead"),
    };
  }

  const data =
    json && typeof json === "object" && "data" in json
      ? (json as { data: unknown }).data
      : undefined;

  if (!isCreatedLead(data)) {
    return {
      ok: false,
      status,
      error: "Lead was not created. Please try again.",
    };
  }

  return { ok: true, lead: data };
}

export function shouldCloseAddLeadModal(result: AddLeadResult) {
  return result.ok;
}

export function mergeCreatedLeadIntoList(prev: Lead[], lead: Lead) {
  if (prev.some((item) => item.id === lead.id)) return prev;
  return [lead, ...prev];
}
