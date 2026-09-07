import { NextRequest } from "next/server";
import { handleTwilioGather } from "@/services/voice-calls";
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
 * Twilio Gather webhook — always HTTP 200 + TwiML.
 */
export async function POST(request: NextRequest) {
  try {
    const params = await parseTwilioForm(request);
    const callId = request.nextUrl.searchParams.get("callId") || "";
    const providerCallId = params.CallSid || "";
    const speechResult = params.SpeechResult || "";

    const signatureOk = isTwilioSignatureValid({
      request,
      params,
      callId,
    });

    if (!signatureOk) {
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
        console.error("[voice:twilio] gather signature validation failed");
        return friendlyHangup(
          "Sorry, we could not verify this call. Goodbye."
        );
      }
      console.warn(
        "[voice:twilio] gather signature mismatch but CallSid matched; continuing"
      );
    }

    if (!callId) {
      return friendlyHangup("Missing call reference. Goodbye.");
    }

    const xml = await handleTwilioGather({ callId, speechResult });
    return twimlResponse(xml);
  } catch (error) {
    console.error("[voice:twilio] gather handler error", {
      errorType: "gather",
      message: error instanceof Error ? error.message : "unknown",
    });
    return friendlyHangup(
      "Sorry, we ran into a technical issue. Goodbye."
    );
  }
}
