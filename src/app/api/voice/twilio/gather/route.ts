import { NextRequest } from "next/server";
import {
  getTwilioConfig,
  validateTwilioRequest,
} from "@/lib/voice/twilio-client";
import { handleTwilioGather } from "@/services/voice-calls";

export const runtime = "nodejs";

async function parseForm(request: NextRequest): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

function twimlResponse(xml: string, status = 200) {
  return new Response(xml, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const params = await parseForm(request);
    const callId = request.nextUrl.searchParams.get("callId") || "";
    const speechResult = params.SpeechResult || "";

    const signature = request.headers.get("x-twilio-signature");
    const cfg = getTwilioConfig();
    const absoluteUrl = `${cfg.webhookBaseUrl}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const skipValidation =
      process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === "true" &&
      process.env.NODE_ENV !== "production";

    if (
      !skipValidation &&
      !validateTwilioRequest({
        signature,
        url: absoluteUrl,
        params,
      })
    ) {
      console.error("[voice:twilio] gather signature validation failed");
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We could not verify this call. Goodbye.</Say><Hangup/></Response>`,
        403
      );
    }

    if (!callId) {
      return twimlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Missing call reference. Goodbye.</Say><Hangup/></Response>`,
        400
      );
    }

    const xml = await handleTwilioGather({ callId, speechResult });
    return twimlResponse(xml);
  } catch (error) {
    console.error("[voice:twilio] gather handler error", {
      errorType: "gather",
      message: error instanceof Error ? error.message : "unknown",
    });
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we ran into a technical issue. Goodbye.</Say><Hangup/></Response>`,
      500
    );
  }
}
