/**
 * Server-side voice appointment booking via Next.js API (never browser).
 */

export type BookFromCallResponse = {
  data?: {
    booked?: boolean;
    appointmentStatus?: string;
    appointmentId?: string;
    externalEventId?: string | null;
    calendarSynced?: boolean;
    preferredText?: string;
    timezone?: string;
    displayWhen?: string;
    reason?: string;
    booking?: {
      booked?: boolean;
      appointmentStatus?: string;
      appointmentId?: string;
      displayWhen?: string;
      timezone?: string;
      preferredText?: string;
      reason?: string;
    };
  };
};

function appBaseUrl(): string {
  const raw =
    process.env.VOICE_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  if (raw) return raw.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("VOICE_APP_URL or APP_URL must be set in production");
  }
  return "http://127.0.0.1:3000";
}

export async function bookAppointmentFromVoiceCall(input: {
  callId: string;
  streamToken: string;
  preferredTimeText?: string;
  timezone?: string;
  explicitConfirmation?: boolean;
}): Promise<{
  booked: boolean;
  appointmentStatus: string;
  displayWhen?: string;
  timezone?: string;
  preferredText?: string;
  reason?: string;
  appointmentId?: string;
}> {
  const url = `${appBaseUrl()}/api/voice/appointments/from-call`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callId: input.callId,
      streamToken: input.streamToken,
      preferredTimeText: input.preferredTimeText,
      timezone: input.timezone,
      explicitConfirmation: input.explicitConfirmation ?? true,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as BookFromCallResponse;
  const row = json.data || {};
  return {
    booked: Boolean(row.booked),
    appointmentStatus: row.appointmentStatus || "failed",
    displayWhen: row.displayWhen,
    timezone: row.timezone,
    preferredText: row.preferredText,
    reason: row.reason,
    appointmentId: row.appointmentId,
  };
}

export async function finalizeVoiceAppointment(input: {
  callId: string;
  streamToken: string;
  preferredTimeText?: string;
  explicitConfirmation?: boolean;
}): Promise<void> {
  const url = `${appBaseUrl()}/api/voice/appointments/finalize`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: input.callId,
        streamToken: input.streamToken,
        mode: "finalize",
        preferredTimeText: input.preferredTimeText,
        explicitConfirmation: input.explicitConfirmation,
      }),
    });
    console.info("[voice-server] appointment finalize", {
      callId: input.callId,
      ok: res.ok,
      status: res.status,
    });
  } catch (error) {
    console.error("[voice-server] appointment finalize failed", {
      callId: input.callId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}
