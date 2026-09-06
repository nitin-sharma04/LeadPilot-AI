/**
 * End an in-progress Twilio call via REST (Status=completed).
 * Never logs the auth token or full request bodies.
 */

export type CompleteTwilioCallResult = {
  ok: boolean;
  status?: number;
  errorType?: string;
};

export async function completeTwilioCall(
  callSid: string
): Promise<CompleteTwilioCallResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    return { ok: false, errorType: "missing_twilio_credentials" };
  }
  if (!callSid?.trim()) {
    return { ok: false, errorType: "missing_provider_call_sid" };
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(callSid.trim())}.json`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }),
    });

    if (res.ok) {
      return { ok: true, status: res.status };
    }

    // 400 often means already completed — treat as success for idempotency
    if (res.status === 400) {
      const body = await res.text().catch(() => "");
      if (/already|completed|not in-progress/i.test(body)) {
        return { ok: true, status: res.status, errorType: "already_completed" };
      }
    }

    return {
      ok: false,
      status: res.status,
      errorType: "provider_error",
    };
  } catch {
    return { ok: false, errorType: "network" };
  }
}

/** Alias matching the product API surface. */
export async function endCall(
  providerCallId: string
): Promise<CompleteTwilioCallResult> {
  return completeTwilioCall(providerCallId);
}
