import { NextRequest } from "next/server";
import { handleTwilioAnswer } from "@/services/voice-calls";
import {
  friendlyHangup,
  isTwilioSignatureValid,
  parseTwilioForm,
  twimlResponse,
} from "@/lib/voice/twilio-webhooks";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio Answer webhook.
 * IMPORTANT: always return HTTP 200 + TwiML. Any 4xx/5xx makes Twilio say
 * "An application error has occurred" and hang up.
 */
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioForm(request);
    const callId = request.nextUrl.searchParams.get("callId") || "";
    const providerCallId = params.CallSid || "";

    const signatureOk = isTwilioSignatureValid({
      request,
      params,
      callId,
    });

    if (!signatureOk) {
      // Soft allow when CallSid maps to our callId — covers URL encoding mismatches.
      let softOk = false;
      if (callId && providerCallId) {
        const found = await prisma.call
          .findFirst({
            where: { id: callId, providerCallId },
            select: { id: true },
          })
          .catch(() => null);
        softOk = Boolean(found);
      }

      if (!softOk) {
        console.error("[voice:twilio] answer signature validation failed", {
          hasCallId: Boolean(callId),
          hasCallSid: Boolean(providerCallId),
        });
        return friendlyHangup(
          "Sorry, we could not verify this call. Please try again later. Goodbye."
        );
      }

      console.warn(
        "[voice:twilio] answer signature mismatch but CallSid matched; continuing"
      );
    }

    if (!callId) {
      return friendlyHangup("Missing call reference. Goodbye.");
    }

    const xml = await handleTwilioAnswer(callId);
    return twimlResponse(xml);
  } catch (error) {
    console.error("[voice:twilio] answer handler error", {
      errorType: "answer",
      message: error instanceof Error ? error.message : "unknown",
    });
    // Still 200 — otherwise Twilio plays the generic application-error prompt.
    return friendlyHangup(
      "Sorry, we ran into a technical issue. Please try again later. Goodbye."
    );
  }
}
