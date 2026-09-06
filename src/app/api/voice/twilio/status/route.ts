import { NextRequest } from "next/server";
import {
  getTwilioConfig,
  validateTwilioRequest,
} from "@/lib/voice/twilio-client";
import { handleTwilioStatus } from "@/services/voice-calls";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function parseForm(request: NextRequest): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

export async function POST(request: NextRequest) {
  try {
    const params = await parseForm(request);
    let callId = request.nextUrl.searchParams.get("callId") || "";
    const providerCallId = params.CallSid || "";

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
      console.error("[voice:twilio] status signature validation failed");
      return new Response("Forbidden", { status: 403 });
    }

    if (!callId && providerCallId) {
      const found = await prisma.call.findFirst({
        where: { providerCallId },
        select: { id: true },
      });
      callId = found?.id ?? "";
    }

    if (!callId) {
      return new Response("OK", { status: 200 });
    }

    await handleTwilioStatus({
      callId,
      callStatus: params.CallStatus || "",
      callDuration: params.CallDuration,
      recordingUrl: params.RecordingUrl,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[voice:twilio] status handler error", {
      errorType: "status",
      message: error instanceof Error ? error.message : "unknown",
    });
    return new Response("OK", { status: 200 });
  }
}
