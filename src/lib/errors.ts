import { AuthError } from "next-auth";

export class AppError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
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
  const message = toErrorMessage(error, fallback);
  const code =
    status ?? (error instanceof AppError ? error.status : 500);
  return Response.json({ error: message }, { status: code });
}
