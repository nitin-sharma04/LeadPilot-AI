/**
 * Next.js instrumentation — runs once on server startup.
 * Validates environment in production without crashing soft-dev.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  // Skip during `next build` — env secrets may be absent at build time on Render
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateEnvironment } = await import("@/lib/env");
  const result = validateEnvironment();

  if (result.warnings.length) {
    console.warn(
      "[env] warnings:",
      result.warnings.map((w) => `${w.key}: ${w.message}`)
    );
  }

  if (!result.ok) {
    const msg = result.issues.map((i) => `${i.key}: ${i.message}`).join("; ");
    if (process.env.NODE_ENV === "production") {
      console.error("[env] CRITICAL — missing required configuration:", msg);
      // Fail health checks rather than crash the whole process mid-deploy
      // so Render can surface logs; routes that need DB will still fail clearly.
    } else {
      console.warn("[env] incomplete local configuration:", msg);
    }
  }
}
