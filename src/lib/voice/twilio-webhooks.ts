/**
 * Shared Twilio webhook helpers — always return HTTP 200 for TwiML.
 * Non-200 responses make Twilio play "An application error has occurred"
 * and ignore the <Say> body.
 */

import { NextRequest } from "next/server";
import {
  buildHangupTwiml,
  getTwilioConfig,
  validateTwilioRequest,
} from "@/lib/voice/twilio-client";

export async function parseTwilioForm(
  request: NextRequest
): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

export function twimlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function webhookBases(): string[] {
  const bases = [
    process.env.VOICE_WEBHOOK_BASE_URL,
    process.env.APP_URL,
    process.env.AUTH_URL,
    process.env.RENDER_EXTERNAL_URL,
  ]
    .map((v) => v?.trim().replace(/\/$/, ""))
    .filter((v): v is string => Boolean(v));
  return [...new Set(bases)];
}

/**
 * Build every plausible public URL Twilio may have signed.
 * Encoding differences on callId are a common false-negative on Render.
 */
export function twilioSignedUrlCandidates(
  request: NextRequest,
  callId: string
): string[] {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search || "";
  const encodedCallId = callId ? encodeURIComponent(callId) : "";
  const candidates = new Set<string>();

  for (const base of webhookBases()) {
    candidates.add(`${base}${pathname}${search}`);
    if (encodedCallId) {
      candidates.add(`${base}${pathname}?callId=${encodedCallId}`);
      candidates.add(`${base}${pathname}?callId=${callId}`);
    }
    candidates.add(`${base}${pathname}`);
  }

  // Last resort: whatever Next thinks the request URL is (may be internal).
  try {
    candidates.add(request.nextUrl.toString());
  } catch {
    /* ignore */
  }

  return [...candidates];
}

export function isTwilioSignatureValid(input: {
  request: NextRequest;
  params: Record<string, string>;
  callId?: string;
}): boolean {
  const skip =
    process.env.TWILIO_SKIP_SIGNATURE_VALIDATION?.trim().toLowerCase() ===
    "true";
  if (skip) {
    console.warn("[voice:twilio] signature validation skipped via env flag");
    return true;
  }

  const signature = input.request.headers.get("x-twilio-signature");
  const callId =
    input.callId ||
    input.request.nextUrl.searchParams.get("callId") ||
    "";

  // Ensure config exists (throws if Twilio env incomplete).
  getTwilioConfig();

  for (const url of twilioSignedUrlCandidates(input.request, callId)) {
    if (
      validateTwilioRequest({
        signature,
        url,
        params: input.params,
      })
    ) {
      return true;
    }
  }

  return false;
}

export function friendlyHangup(message: string) {
  return twimlResponse(buildHangupTwiml({ sayText: message }));
}
