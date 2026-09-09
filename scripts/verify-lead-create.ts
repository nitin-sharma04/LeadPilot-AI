/**
 * Focused checks for dashboard Add Lead create contract.
 * Run: npx tsx scripts/verify-lead-create.ts
 */
import { LeadSource } from "@prisma/client";
import {
  DuplicateLeadError,
  jsonError,
  sanitizeErrorLogMessage,
  shouldLogUnexpectedApiError,
} from "../src/lib/errors";
import {
  buildDashboardLeadCreateBody,
  interpretLeadCreateResponse,
  mergeCreatedLeadIntoList,
  shouldCloseAddLeadModal,
} from "../src/lib/lead-create-client";
import { createLeadSchema } from "../src/lib/validations";
import {
  maybeRejectDuplicateLead,
  normalizeLeadEmail,
  normalizeLeadPhone,
} from "../src/services/leads";
import type { Lead } from "../src/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sampleLead(id: string): Lead {
  return {
    id,
    name: "Ada Lovelace",
    company: "Analytical Engines",
    email: "ada@example.com",
    phone: "4155550100",
    industry: "General",
    source: "Website",
    score: 50,
    dealValue: 5000,
    status: "new",
    ownerId: "user_1",
    createdAt: new Date().toISOString(),
    message: "Interested in a demo",
    intent: "Medium",
    urgency: "Medium",
    estimatedBudget: "To be determined",
    recommendedAction: "Qualify this lead and schedule a first touch.",
  };
}

async function main() {
  const payload = buildDashboardLeadCreateBody({
    name: "Ada Lovelace",
    company: "Analytical Engines",
    email: "  Ada@Example.com ",
    phone: " (415) 555-0100 ",
    source: "Website",
    dealValue: "5000.9",
    message: "Interested in a demo",
  });

  assert(payload.companyName === "Analytical Engines", "company → companyName");
  assert(payload.source === LeadSource.WEBSITE, "source maps to WEBSITE");
  assert(payload.dealValue === 5000, "deal value truncated to int");
  assert(payload.email === "ada@example.com", "email trimmed + lowercased");
  assert(payload.phone === "(415) 555-0100", "non-empty phone kept for schema");
  assert(payload.message === "Interested in a demo", "message field present");
  assert(!("company" in payload), "must not send UI company key");
  assert(!("companyId" in payload), "must not send companyId from browser");

  const parsed = createLeadSchema.safeParse(payload);
  assert(parsed.success, "valid dashboard payload matches Zod schema");
  if (parsed.success) {
    assert(parsed.data.email === "ada@example.com", "schema email normalized");
    assert(parsed.data.dealValue === 5000, "schema dealValue is int");
  }

  const emptyPhone = buildDashboardLeadCreateBody({
    name: "Ada Lovelace",
    company: "Analytical Engines",
    email: "ada@example.com",
    phone: "   ",
    source: "Website",
    dealValue: 0,
    message: "",
  });
  assert(!("phone" in emptyPhone), "empty phone omitted from payload");
  assert(!("message" in emptyPhone), "empty message omitted from payload");
  const emptyPhoneParsed = createLeadSchema.safeParse(emptyPhone);
  assert(emptyPhoneParsed.success, "empty phone/message still valid");
  if (emptyPhoneParsed.success) {
    assert(emptyPhoneParsed.data.phone === undefined, "empty phone becomes undefined");
  }

  const blankPhoneSchema = createLeadSchema.safeParse({
    name: "Ada Lovelace",
    email: "ada@example.com",
    companyName: "Analytical Engines",
    phone: "",
  });
  assert(blankPhoneSchema.success, "schema accepts empty phone string");
  if (blankPhoneSchema.success) {
    assert(blankPhoneSchema.data.phone === undefined, "schema empty phone → undefined");
  }

  const invalid = createLeadSchema.safeParse({
    name: "A",
    email: "not-an-email",
    companyName: "",
  });
  assert(!invalid.success, "validation failure rejected");

  const floatDeal = createLeadSchema.safeParse({
    name: "Ada Lovelace",
    email: "ada@example.com",
    companyName: "Analytical Engines",
    dealValue: 12.5,
  });
  assert(!floatDeal.success, "must not weaken dealValue int validation");

  assert(normalizeLeadEmail("  Ada@Example.com ") === "ada@example.com", "email normalize");
  assert(normalizeLeadPhone(" (415) 555-0100 ") === "4155550100", "phone digits kept");
  assert(normalizeLeadPhone("") === null, "empty phone → null");
  assert(normalizeLeadPhone("   ") === null, "whitespace phone → null");

  let emailDupThrown = false;
  try {
    maybeRejectDuplicateLead(true, "lead_existing_email", "email");
  } catch (error) {
    emailDupThrown = error instanceof DuplicateLeadError;
    assert(error instanceof DuplicateLeadError, "duplicate email throws DuplicateLeadError");
    assert(error.existingLeadId === "lead_existing_email", "email duplicate id");
    assert(error.status === 409, "duplicate email status 409");
    const response = jsonError(error);
    assert(response.status === 409, "jsonError duplicate email → 409");
    const body = (await response.json()) as {
      error?: string;
      existingLeadId?: string;
    };
    assert(
      body.error === "A lead with this email or phone already exists.",
      "duplicate email user-facing message"
    );
    assert(body.existingLeadId === "lead_existing_email", "duplicate email existingLeadId");
  }
  assert(emailDupThrown, "dashboard duplicate email is rejected");
  maybeRejectDuplicateLead(false, "lead_existing_email", "email");

  let phoneDupThrown = false;
  try {
    maybeRejectDuplicateLead(true, "lead_existing_phone", "phone");
  } catch (error) {
    phoneDupThrown = error instanceof DuplicateLeadError;
    assert(error instanceof DuplicateLeadError, "duplicate phone throws DuplicateLeadError");
    const response = jsonError(error);
    assert(response.status === 409, "jsonError duplicate phone → 409");
    const body = (await response.json()) as { existingLeadId?: string };
    assert(body.existingLeadId === "lead_existing_phone", "duplicate phone existingLeadId");
  }
  assert(phoneDupThrown, "dashboard duplicate phone is rejected");
  maybeRejectDuplicateLead(undefined, "lead_existing_phone", "phone");

  const created = sampleLead("lead_new");
  const success = interpretLeadCreateResponse({
    ok: true,
    status: 201,
    json: { data: created },
  });
  assert(success.ok && success.lead.id === "lead_new", "successful creation requires data.id");
  assert(shouldCloseAddLeadModal(success), "successful API response closes modal");

  const missingId = interpretLeadCreateResponse({
    ok: true,
    status: 201,
    json: { data: { name: "No id" } },
  });
  assert(!missingId.ok, "2xx without data.id is not success");
  assert(!shouldCloseAddLeadModal(missingId), "missing id keeps modal open");

  const validationFailure = interpretLeadCreateResponse({
    ok: false,
    status: 400,
    json: { error: "Name is required" },
  });
  assert(!validationFailure.ok, "validation failure is not success");
  assert(validationFailure.error === "Name is required", "shows API validation message");
  assert(!shouldCloseAddLeadModal(validationFailure), "API failure keeps modal open");

  const serverFailure = interpretLeadCreateResponse({
    ok: false,
    status: 500,
    json: { error: "Unable to create lead" },
  });
  assert(!shouldCloseAddLeadModal(serverFailure), "500 keeps modal open");

  const duplicate = interpretLeadCreateResponse({
    ok: false,
    status: 409,
    json: {
      error: "A lead with this email or phone already exists.",
      existingLeadId: "lead_existing_email",
    },
  });
  assert(!duplicate.ok, "409 is not success");
  assert(
    duplicate.error === "This lead already exists in your workspace.",
    "409 uses workspace-facing message"
  );
  assert(duplicate.existingLeadId === "lead_existing_email", "409 keeps existingLeadId");
  assert(!shouldCloseAddLeadModal(duplicate), "duplicate keeps modal open");

  const existing = sampleLead("lead_existing_email");
  const afterDup = mergeCreatedLeadIntoList([existing], existing);
  assert(afterDup.length === 1, "duplicate response does not duplicate UI row");

  const afterCreate = mergeCreatedLeadIntoList([existing], created);
  assert(afterCreate.length === 2, "new lead is prepended");
  assert(afterCreate[0].id === "lead_new", "new lead is first");

  assert(
    !shouldLogUnexpectedApiError(new DuplicateLeadError("lead_1", "email")),
    "409 duplicates are not unexpected logs"
  );
  assert(shouldLogUnexpectedApiError(new Error("db down")), "unexpected errors are logged");
  assert(
    sanitizeErrorLogMessage("Bearer sk-live-secret Gemini_API_KEY=abc Twilio token=xyz").includes(
      "[redacted]"
    ),
    "secrets are not logged"
  );
  assert(
    !sanitizeErrorLogMessage("token=supersecretvalue").includes("supersecretvalue"),
    "token values stripped"
  );

  console.log("Lead create verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
