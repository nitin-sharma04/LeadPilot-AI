import { AppError } from "@/lib/errors";
import type { VoiceProvider } from "@/lib/voice/provider";
import {
  initiateTwilioOutboundCall,
  isTwilioConfigured,
} from "@/lib/voice/twilio-client";

export function createTwilioVoiceProvider(): VoiceProvider {
  return {
    id: "twilio",
    displayName: "Twilio",
    async initiateOutboundCall(input) {
      if (!isTwilioConfigured()) {
        throw new AppError(
          "Voice calling is not configured. Set Twilio credentials on the server.",
          503
        );
      }
      const result = await initiateTwilioOutboundCall({
        to: input.toPhoneNumber,
        callId: input.callId,
      });
      return {
        provider: "twilio",
        providerCallId: result.providerCallId,
        status: result.status,
      };
    },
  };
}

export function resolveVoiceProviderId(
  value: string | undefined = process.env.VOICE_PROVIDER
): "twilio" {
  const normalized = (value ?? "twilio").trim().toLowerCase();
  if (normalized === "twilio") return "twilio";
  throw new AppError("Invalid VOICE_PROVIDER. Currently supported: twilio.", 503);
}

export function getVoiceProvider(): VoiceProvider {
  resolveVoiceProviderId();
  return createTwilioVoiceProvider();
}
