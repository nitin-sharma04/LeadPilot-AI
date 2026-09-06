import { AppError } from "@/lib/errors";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  webhookBaseUrl: string;
};

export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
  const webhookBaseUrl = (
    process.env.VOICE_WEBHOOK_BASE_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    ""
  ).replace(/\/$/, "");

  if (!accountSid || !authToken || !phoneNumber) {
    throw new AppError(
      "Voice calling is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
      503
    );
  }

  if (!webhookBaseUrl) {
    throw new AppError(
      "Voice webhooks are not configured. Set VOICE_WEBHOOK_BASE_URL (public HTTPS URL) or AUTH_URL.",
      503
    );
  }

  if (
    webhookBaseUrl.includes("localhost") ||
    webhookBaseUrl.includes("127.0.0.1")
  ) {
    // Twilio cannot reach localhost — still allow config for dry-run failures with clear guidance.
    console.warn(
      "[voice:twilio] VOICE_WEBHOOK_BASE_URL points to localhost. Twilio requires a public HTTPS URL (e.g. ngrok)."
    );
  }

  return { accountSid, authToken, phoneNumber, webhookBaseUrl };
}

export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_PHONE_NUMBER?.trim()
  );
}

export type InitiateTwilioCallInput = {
  to: string;
  callId: string;
};

export type InitiateTwilioCallResult = {
  providerCallId: string;
  status: string;
};

/**
 * Initiate an outbound Programmable Voice call via Twilio REST API.
 * Uses current Calls resource: POST /2010-04-01/Accounts/{Sid}/Calls.json
 * Never logs auth tokens.
 */
export async function initiateTwilioOutboundCall(
  input: InitiateTwilioCallInput
): Promise<InitiateTwilioCallResult> {
  const cfg = getTwilioConfig();
  const answerUrl = `${cfg.webhookBaseUrl}/api/voice/twilio/answer?callId=${encodeURIComponent(input.callId)}`;
  const statusUrl = `${cfg.webhookBaseUrl}/api/voice/twilio/status?callId=${encodeURIComponent(input.callId)}`;

  const body = new URLSearchParams({
    To: input.to,
    From: cfg.phoneNumber,
    Url: answerUrl,
    Method: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"].join(" "),
  });

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64"
  );
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
  } catch {
    console.error("[voice:twilio] network failure initiating call", {
      provider: "twilio",
      errorType: "network",
    });
    throw new AppError(
      "Unable to reach Twilio. Please try again.",
      502
    );
  }

  const raw = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    json = {};
  }

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message.toLowerCase()
        : raw.toLowerCase();
    console.error("[voice:twilio] create call failed", {
      provider: "twilio",
      httpStatus: response.status,
      errorType: "provider_error",
      code: typeof json.code === "number" ? json.code : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
        503
      );
    }
    if (message.includes("phone") || message.includes("number")) {
      throw new AppError(
        "Twilio rejected the phone number. Use a valid E.164 number.",
        400
      );
    }
    throw new AppError(
      "Unable to start the call with Twilio. Please try again.",
      502
    );
  }

  const sid = typeof json.sid === "string" ? json.sid : "";
  if (!sid) {
    throw new AppError(
      "Twilio did not return a call identifier. Please try again.",
      502
    );
  }

  console.info("[voice:twilio] outbound call created", {
    provider: "twilio",
    callId: input.callId,
    providerCallIdPresent: true,
    status: typeof json.status === "string" ? json.status : "unknown",
  });

  return {
    providerCallId: sid,
    status: typeof json.status === "string" ? json.status : "queued",
  };
}

/**
 * Terminate an in-progress Twilio call via REST (Status=completed).
 * Server-side only. Never logs the auth token.
 */
export async function endTwilioCall(providerCallId: string): Promise<{
  ok: boolean;
  status?: number;
  errorType?: string;
}> {
  if (!providerCallId?.trim()) {
    return { ok: false, errorType: "missing_provider_call_sid" };
  }

  let cfg: TwilioConfig;
  try {
    cfg = getTwilioConfig();
  } catch {
    return { ok: false, errorType: "missing_twilio_credentials" };
  }

  const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString(
    "base64"
  );
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls/${encodeURIComponent(providerCallId.trim())}.json`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }),
      cache: "no-store",
    });

    if (response.ok) {
      console.info("[voice:twilio] call hangup requested", {
        provider: "twilio",
        providerCallIdPresent: true,
        httpStatus: response.status,
      });
      return { ok: true, status: response.status };
    }

    if (response.status === 400) {
      const raw = await response.text().catch(() => "");
      if (/already|completed|not in-progress/i.test(raw)) {
        return { ok: true, status: response.status, errorType: "already_completed" };
      }
    }

    console.error("[voice:twilio] hangup failed", {
      provider: "twilio",
      httpStatus: response.status,
      errorType: "provider_error",
    });
    return { ok: false, status: response.status, errorType: "provider_error" };
  } catch {
    console.error("[voice:twilio] hangup network failure", {
      provider: "twilio",
      errorType: "network",
    });
    return { ok: false, errorType: "network" };
  }
}

/**
 * Validate Twilio webhook signature using the official algorithm
 * (X-Twilio-Signature + HMAC-SHA1 over URL + sorted POST params).
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioRequest(input: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return false;
  if (!input.signature) return false;

  // Prefer official SDK validator when available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require("twilio") as {
      validateRequest: (
        authToken: string,
        signature: string,
        url: string,
        params: Record<string, string>
      ) => boolean;
    };
    return twilio.validateRequest(
      authToken,
      input.signature,
      input.url,
      input.params
    );
  } catch {
    return false;
  }
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildGatherTwiml(input: {
  sayText: string;
  actionUrl: string;
  voice?: string;
}): string {
  const voice = input.voice || "Polly.Joanna";
  const say = escapeXml(input.sayText.slice(0, 1500));
  const action = escapeXml(input.actionUrl);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" language="en-US" action="${action}" method="POST" actionOnEmptyResult="true">
    <Say voice="${voice}">${say}</Say>
  </Gather>
  <Say voice="${voice}">I did not catch that. Goodbye for now.</Say>
  <Hangup/>
</Response>`;
}

export function buildHangupTwiml(input: {
  sayText: string;
  voice?: string;
}): string {
  const voice = input.voice || "Polly.Joanna";
  const say = escapeXml(input.sayText.slice(0, 1500));
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}">${say}</Say>
  <Hangup/>
</Response>`;
}

/**
 * Bidirectional Media Stream via current Twilio TwiML:
 * <Connect><Stream url="wss://..." /></Connect>
 * @see https://www.twilio.com/docs/voice/twiml/stream
 */
export function buildConnectStreamTwiml(input: {
  streamUrl: string;
  callId: string;
  streamToken: string;
}): string {
  const url = escapeXml(input.streamUrl);
  const callId = escapeXml(input.callId);
  const token = escapeXml(input.streamToken);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${url}">
      <Parameter name="callId" value="${callId}" />
      <Parameter name="streamToken" value="${token}" />
    </Stream>
  </Connect>
  <Hangup/>
</Response>`;
}
