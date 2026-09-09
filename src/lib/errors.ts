import { AuthError } from "next-auth";

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export class DuplicateLeadError extends AppError {
  existingLeadId: string;
  field: "email" | "phone";

  constructor(existingLeadId: string, field: "email" | "phone") {
    super("A lead with this email or phone already exists.", 409);
    this.name = "DuplicateLeadError";
    this.existingLeadId = existingLeadId;
    this.field = field;
  }
}

export function toErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (error instanceof AppError) return error.message;
  if (error instanceof AuthError) return "Invalid email or password";
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    if (
      error.message.includes("Unique constraint") ||
      error.message.includes("Foreign key") ||
      error.message.toLowerCase().includes("prisma")
    ) {
      return fallback;
    }
    return error.message || fallback;
  }
  return fallback;
}

export function jsonError(error: unknown, fallback?: string, status?: number) {
  if (error instanceof DuplicateLeadError) {
    return Response.json(
      {
        error: error.message,
        existingLeadId: error.existingLeadId,
      },
      { status: 409 }
    );
  }
  const message = toErrorMessage(error, fallback);
  const code =
    status ?? (error instanceof AppError ? error.status : 500);
  return Response.json({ error: message }, { status: code });
}

const SECRET_FRAGMENT =
  /(api[_-]?key|auth(?:orization)?|bearer|token|secret|password|twilio|gemini|deepgram|sk-|whsec_)[^\s,;]*/gi;

export function sanitizeErrorLogMessage(value: string) {
  return value.replace(SECRET_FRAGMENT, "[redacted]").slice(0, 300);
}

export function shouldLogUnexpectedApiError(error: unknown) {
  if (error instanceof DuplicateLeadError) return false;
  if (error instanceof AppError) return error.status >= 500;
  return true;
}

export function logUnexpectedApiError(
  route: string,
  error: unknown,
  extra?: Record<string, string | number | boolean | undefined>
) {
  if (!shouldLogUnexpectedApiError(error)) return;
  const status = error instanceof AppError ? error.status : 500;
  const rawMessage = error instanceof Error ? error.message : String(error);
  console.error("[api] unexpected failure", {
    route,
    status,
    errorType: error instanceof Error ? error.name : typeof error,
    message: sanitizeErrorLogMessage(rawMessage),
    ...extra,
  });
}
