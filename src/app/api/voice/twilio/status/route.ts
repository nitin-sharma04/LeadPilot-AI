import { NextRequest } from "next/server";
import { handleTwilioStatus } from "@/services/voice-calls";
import { prisma } from "@/lib/prisma";
import {
  isTwilioSignatureValid,
  parseTwilioForm,
} from "@/lib/voice/twilio-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio status callback — always HTTP 200 so Twilio keeps sending events.
 */
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioForm(request);
    let callId = request.nextUrl.searchParams.get("callId") || "";
    const providerCallId = params.CallSid || "";

    const signatureOk = isTwilioSignatureValid({
      request,
      params,
      callId,
    });

    if (!signatureOk) {
      // Still accept status when CallSid is known — prevents stuck "in progress".
      if (providerCallId) {
        const found = await prisma.call
          .findFirst({
            where: { providerCallId },
            select: { id: true },
          })
          .catch(() => null);
        if (found) {
          callId = found.id;
          console.warn(
            "[voice:twilio] status signature mismatch but CallSid matched; applying status"
          );
        } else {
          console.error("[voice:twilio] status signature validation failed");
          return new Response("OK", { status: 200 });
        }
      } else {
        console.error("[voice:twilio] status signature validation failed");
        return new Response("OK", { status: 200 });
      }
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
