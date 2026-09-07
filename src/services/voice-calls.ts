import { CallStatus, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import {
  buildConnectStreamTwiml,
  buildGatherTwiml,
  buildHangupTwiml,
  endTwilioCall,
  fetchTwilioCallStatus,
  getTwilioConfig,
} from "@/lib/voice/twilio-client";
import {
  createStreamToken,
  getVoiceStreamUrl,
  resolveEffectiveVoiceMode,
} from "@/lib/voice/mode";
import {
  generateCallSummary,
  generateVoiceTurn,
} from "@/lib/ai/voice-agent";
import type { VoiceAgentLeadContext } from "@/lib/ai/prompts/voice-agent";
import { normalizeTranscriptText } from "@/lib/voice/transcript-cleanup";

const inFlight = new Set<string>();
const lastCallAt = new Map<string, number>();
const finalizingCalls = new Set<string>();
const COOLDOWN_MS = 60_000;
/** Twilio must get TwiML back well under ~15s or it plays "an application error has occurred". */
const VOICE_AI_DEADLINE_MS = 10_000;

function defaultOpening(lead: VoiceAgentLeadContext): string {
  const first = lead.name.split(" ")[0] || "there";
  return `Hi ${first}, this is ${lead.agentName}, an AI assistant calling from ${lead.sellerCompanyName}. Do you have a quick moment to chat about your recent interest?`;
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`voice AI deadline exceeded (${ms}ms)`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const ACTIVE_STATUSES: CallStatus[] = [
  CallStatus.INITIATING,
  CallStatus.RINGING,
  CallStatus.IN_PROGRESS,
  CallStatus.CONNECTED,
];

/** Calls stuck in active status longer than this are auto-canceled (safety). */
function getStaleCallThresholdMs(): number {
  const maxDurationSec = Number.parseInt(
    process.env.VOICE_MAX_CALL_DURATION_SECONDS || "600",
    10
  );
  const staleSec = Number.parseInt(
    process.env.VOICE_STALE_CALL_SECONDS || "",
    10
  );
  // Default: max call duration + 2 minutes, floor 10 minutes.
  const derived = (Number.isFinite(maxDurationSec) ? maxDurationSec : 600) + 120;
  if (Number.isFinite(staleSec) && staleSec >= 120) return staleSec * 1000;
  return Math.max(derived, 600) * 1000;
}

function isCallStale(call: {
  status: CallStatus;
  startedAt: Date | null;
  createdAt: Date;
}): boolean {
  if (!ACTIVE_STATUSES.includes(call.status)) return false;
  const started = (call.startedAt ?? call.createdAt).getTime();
  return Date.now() - started > getStaleCallThresholdMs();
}

/**
 * If a call is stuck "active" past the stale threshold, mark it canceled
 * and attempt Twilio hangup. Prevents permanent "Call in progress" UI.
 */
export async function reconcileStaleCall<
  T extends {
    id: string;
    status: CallStatus;
    startedAt: Date | null;
    createdAt: Date;
    providerCallId: string | null;
    companyId: string;
    leadId: string;
    agentId: string | null;
    outcome?: string | null;
  },
>(call: T): Promise<T> {
  if (!isCallStale(call)) return call;

  if (call.providerCallId) {
    await endTwilioCall(call.providerCallId).catch(() => ({
      ok: false,
    }));
  }

  const updated = await prisma.call.update({
    where: { id: call.id },
    data: {
      status: CallStatus.CANCELED,
      endedAt: new Date(),
      outcome: call.outcome ?? "Canceled stuck call (stale timeout)",
    },
  });

  await prisma.activity
    .create({
      data: {
        companyId: call.companyId,
        leadId: call.leadId,
        userId: call.agentId,
        type: "AI_VOICE_CALL",
        description: "Stuck AI call auto-canceled (no longer in progress)",
      },
    })
    .catch(() => undefined);

  console.info("[voice] stale call reconciled", {
    callId: call.id,
    previousStatus: call.status,
  });

  return { ...call, ...updated };
}

/**
 * When status webhooks are missed, sync terminal Twilio state into our DB
 * so the dashboard stops showing "Call in progress".
 */
export async function syncCallStatusFromTwilio<
  T extends {
    id: string;
    status: CallStatus;
    providerCallId: string | null;
    answeredAt?: Date | null;
    outcome?: string | null;
  },
>(call: T): Promise<T> {
  if (!call.providerCallId || !ACTIVE_STATUSES.includes(call.status)) {
    return call;
  }

  const remote = await fetchTwilioCallStatus(call.providerCallId);
  if (!remote.status) return call;

  const mapped = mapTwilioStatus(remote.status);
  if (!mapped) return call;
  if (mapped === call.status) return call;

  await handleTwilioStatus({
    callId: call.id,
    callStatus: remote.status,
    callDuration:
      remote.duration != null ? String(remote.duration) : undefined,
  });

  const refreshed = await prisma.call.findUnique({ where: { id: call.id } });
  if (!refreshed) return call;
  return { ...call, ...refreshed };
}

export async function cancelStaleCallsForLead(input: {
  companyId: string;
  leadId: string;
}) {
  const active = await prisma.call.findMany({
    where: {
      companyId: input.companyId,
      leadId: input.leadId,
      status: { in: ACTIVE_STATUSES },
    },
  });
  for (const call of active) {
    const synced = await syncCallStatusFromTwilio(call);
    await reconcileStaleCall(synced);
  }
}
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 11 && digits.length <= 16) {
    return digits;
  }
  const only = digits.replace(/\D/g, "");
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith("1")) return `+${only}`;
  if (only.length >= 10 && only.length <= 15) return `+${only}`;
  return null;
}

function mapTwilioStatus(status: string): CallStatus | null {
  switch (status.toLowerCase()) {
    case "queued":
    case "initiated":
      return CallStatus.INITIATING;
    case "ringing":
      return CallStatus.RINGING;
    case "in-progress":
    case "answered":
      return CallStatus.IN_PROGRESS;
    case "completed":
      return CallStatus.COMPLETED;
    case "busy":
      return CallStatus.BUSY;
    case "no-answer":
      return CallStatus.NO_ANSWER;
    case "canceled":
    case "cancelled":
      return CallStatus.CANCELED;
    case "failed":
      return CallStatus.FAILED;
    default:
      return null;
  }
}

async function buildLeadContext(callId: string): Promise<{
  lead: VoiceAgentLeadContext;
  call: {
    id: string;
    companyId: string;
    leadId: string;
    status: CallStatus;
  };
}> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      lead: { include: { analysis: true } },
      company: true,
      agent: true,
    },
  });
  if (!call) throw new AppError("Call not found", 404);

  const analysis = call.lead.analysis;
  return {
    call: {
      id: call.id,
      companyId: call.companyId,
      leadId: call.leadId,
      status: call.status,
    },
    lead: {
      name: call.lead.name,
      companyName: call.lead.companyName,
      jobTitle: call.lead.jobTitle,
      industry: analysis?.industry || call.lead.industry,
      source: call.lead.source,
      notes: call.lead.message,
      score: analysis?.score ?? call.lead.score,
      intent: analysis?.intent ?? call.lead.intent,
      urgency: analysis?.urgency ?? call.lead.urgency,
      buyingStage: analysis?.buyingStage,
      requirements: analysis?.requirements ?? [],
      painPoints: analysis?.painPoints ?? [],
      objections: analysis?.objections ?? [],
      recommendation: analysis?.recommendation,
      agentName: call.agent?.name?.split(" ")[0] || "Alex",
      sellerCompanyName: call.company.name,
    },
  };
}

export async function initiateAiVoiceCall(
  user: SessionUser,
  leadId: string
) {
  const key = `${user.companyId}:${leadId}`;
  if (inFlight.has(key)) {
    throw new AppError("A call is already being started for this lead.", 429);
  }

  const last = lastCallAt.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    throw new AppError(
      "Please wait a minute before starting another AI call to this lead.",
      429
    );
  }

  // Ensure AI + Twilio config exist before creating DB rows that would be orphaned.
  getTwilioConfig();
  getVoiceProvider();

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
  });
  if (!lead) throw new AppError("Lead not found", 404);
  if (!lead.phone?.trim()) {
    throw new AppError("This lead does not have a phone number.", 400);
  }

  const phone = normalizePhone(lead.phone);
  if (!phone) {
    throw new AppError(
      "Lead phone number is invalid. Use E.164 format (e.g. +15551234567).",
      400
    );
  }

  // Clear stuck "active" calls so the UI/API cannot block forever.
  await cancelStaleCallsForLead({
    companyId: user.companyId,
    leadId,
  });

  const active = await prisma.call.findFirst({
    where: {
      companyId: user.companyId,
      leadId,
      status: { in: ACTIVE_STATUSES },
    },
  });
  if (active) {
    throw new AppError(
      "There is already an active call for this lead. Wait for it to finish.",
      429
    );
  }

  inFlight.add(key);
  try {
    const effective = resolveEffectiveVoiceMode();
    const streamToken =
      effective.mode === "realtime" ? createStreamToken() : null;

    if (effective.fallbackReason) {
      console.warn("[voice] realtime unavailable; using turn_based", {
        reason: effective.fallbackReason,
      });
    }

    const call = await prisma.call.create({
      data: {
        companyId: user.companyId,
        leadId: lead.id,
        agentId: user.id,
        provider: "twilio",
        direction: "OUTBOUND",
        status: CallStatus.INITIATING,
        phoneNumber: phone,
        voiceMode: effective.mode,
        streamToken,
        startedAt: new Date(),
      },
    });

    try {
      const provider = getVoiceProvider();
      const result = await provider.initiateOutboundCall({
        callId: call.id,
        toPhoneNumber: phone,
      });

      const updated = await prisma.call.update({
        where: { id: call.id },
        data: {
          providerCallId: result.providerCallId,
          status: CallStatus.RINGING,
        },
      });

      await prisma.activity.create({
        data: {
          companyId: user.companyId,
          leadId: lead.id,
          userId: user.id,
          type: "AI_VOICE_CALL",
          description: `AI sales call initiated (${effective.mode})`,
        },
      });

      lastCallAt.set(key, Date.now());
      return serializeCall(updated);
    } catch (error) {
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.FAILED,
          endedAt: new Date(),
          outcome: "Failed to connect",
        },
      });
      throw error;
    }
  } finally {
    inFlight.delete(key);
  }
}

export async function getCallForUser(user: SessionUser, callId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, companyId: user.companyId },
    include: {
      lead: true,
      agent: true,
      summary: true,
      transcripts: { orderBy: { timestamp: "asc" } },
    },
  });
  if (!call) throw new AppError("Call not found", 404);

  // Prefer live Twilio state over a missed status webhook, then stale timeout.
  const synced = await syncCallStatusFromTwilio(call);
  const reconciled = await reconcileStaleCall(synced);
  if (
    reconciled.status !== call.status ||
    synced.status !== call.status
  ) {
    return prisma.call.findFirstOrThrow({
      where: { id: callId, companyId: user.companyId },
      include: {
        lead: true,
        agent: true,
        summary: true,
        transcripts: { orderBy: { timestamp: "asc" } },
      },
    });
  }

  return call;
}

export async function handleTwilioAnswer(callId: string): Promise<string> {
  const { lead, call } = await buildLeadContext(callId);
  const cfg = getTwilioConfig();

  const callRow = await prisma.call.findUnique({ where: { id: call.id } });
  if (!callRow) throw new AppError("Call not found", 404);

  await prisma.call.update({
    where: { id: call.id },
    data: {
      status: CallStatus.IN_PROGRESS,
      answeredAt: new Date(),
    },
  });

  // Realtime path: bidirectional Media Stream (no Gather)
  if (callRow.voiceMode === "realtime" && callRow.streamToken) {
    const streamUrl = getVoiceStreamUrl();
    if (!streamUrl) {
      console.error("[voice] realtime call missing VOICE_STREAM_URL; failing safely");
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: CallStatus.FAILED,
          endedAt: new Date(),
          outcome: "Realtime voice stream not configured",
        },
      });
      return buildHangupTwiml({
        sayText:
          "Sorry, our realtime voice service is not available right now. Please try again later. Goodbye.",
      });
    }
    return buildConnectStreamTwiml({
      streamUrl,
      callId: call.id,
      streamToken: callRow.streamToken,
    });
  }

  // Turn-based: respond immediately with a template opening.
  // Waiting on Gemini here routinely exceeds Twilio's webhook limit (~15s)
  // and Twilio then says "an application error has occurred" and hangs up.
  const opening = defaultOpening(lead);

  await prisma.callTranscript.create({
    data: {
      callId: call.id,
      speaker: "AI",
      message: opening,
    },
  });

  const actionUrl = `${cfg.webhookBaseUrl}/api/voice/twilio/gather?callId=${encodeURIComponent(call.id)}`;
  return buildGatherTwiml({ sayText: opening, actionUrl });
}

export async function handleTwilioGather(input: {
  callId: string;
  speechResult: string;
}): Promise<string> {
  const { lead, call } = await buildLeadContext(input.callId);
  const cfg = getTwilioConfig();
  const utterance = input.speechResult.trim();

  if (utterance) {
    await prisma.callTranscript.create({
      data: {
        callId: call.id,
        speaker: "LEAD",
        message: utterance,
      },
    });
  }

  const transcripts = await prisma.callTranscript.findMany({
    where: { callId: call.id },
    orderBy: { timestamp: "asc" },
  });

  const history = transcripts.map((t) => ({
    speaker: (t.speaker === "AI" ? "agent" : "lead") as "agent" | "lead",
    text: t.message,
  }));

  let turn;
  try {
    turn = await withDeadline(
      generateVoiceTurn({
        lead,
        transcript: history,
        leadUtterance: utterance || "(no speech detected)",
      }),
      VOICE_AI_DEADLINE_MS
    );
  } catch (error) {
    console.warn("[voice] gather AI deadline/fallback", {
      callId: call.id,
      message: error instanceof Error ? error.message : "unknown",
    });
    turn = {
      reply:
        utterance.trim().length === 0
          ? "Sorry, I did not catch that. Could you please repeat that briefly?"
          : "Thanks for sharing that. I'll have someone from our team follow up with you shortly. Goodbye.",
      endCall: utterance.trim().length > 0,
      handoffRequested: false,
      appointmentRequested: false,
      optOut: false,
    };
  }

  await prisma.callTranscript.create({
    data: {
      callId: call.id,
      speaker: "AI",
      message: turn.reply,
    },
  });

  if (turn.optOut || turn.endCall || turn.handoffRequested) {
    if (turn.optOut) {
      const leadRow = await prisma.lead.findUnique({
        where: { id: call.leadId },
      });
      if (leadRow) {
        const note = "[Do not call — requested during AI voice call]";
        await prisma.lead.update({
          where: { id: leadRow.id },
          data: {
            message: leadRow.message?.includes(note)
              ? leadRow.message
              : `${leadRow.message ? `${leadRow.message}\n` : ""}${note}`,
            status: LeadStatus.LOST,
          },
        });
      }
    }

    return buildHangupTwiml({ sayText: turn.reply });
  }

  const actionUrl = `${cfg.webhookBaseUrl}/api/voice/twilio/gather?callId=${encodeURIComponent(call.id)}`;
  return buildGatherTwiml({ sayText: turn.reply, actionUrl });
}

export async function handleTwilioStatus(input: {
  callId: string;
  callStatus: string;
  callDuration?: string;
  recordingUrl?: string;
}): Promise<void> {
  const call = await prisma.call.findUnique({ where: { id: input.callId } });
  if (!call) return;

  const mapped = mapTwilioStatus(input.callStatus);
  if (!mapped) return;

  const durationSeconds = input.callDuration
    ? Number.parseInt(input.callDuration, 10)
    : undefined;

  const data: Prisma.CallUpdateInput = {
    status: mapped,
  };

  if (mapped === CallStatus.IN_PROGRESS && !call.answeredAt) {
    data.answeredAt = new Date();
  }

  if (
    mapped === CallStatus.COMPLETED ||
    mapped === CallStatus.FAILED ||
    mapped === CallStatus.NO_ANSWER ||
    mapped === CallStatus.BUSY ||
    mapped === CallStatus.CANCELED
  ) {
    data.endedAt = new Date();
    if (Number.isFinite(durationSeconds)) {
      data.duration = durationSeconds;
    }
    if (input.recordingUrl) {
      data.recordingUrl = input.recordingUrl;
    }
  }

  await prisma.call.update({ where: { id: call.id }, data });

  if (mapped === CallStatus.COMPLETED) {
    // Fire-and-forget so status webhook returns quickly; finalize is idempotent.
    void finalizeCompletedCall(call.id).catch((error) => {
      console.error("[voice] finalize call failed", {
        callId: call.id,
        errorType: "finalize",
        message: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}

async function finalizeCompletedCall(callId: string) {
  if (finalizingCalls.has(callId)) return;
  finalizingCalls.add(callId);
  try {
    await finalizeCompletedCallInner(callId);
  } finally {
    finalizingCalls.delete(callId);
  }
}

async function finalizeCompletedCallInner(callId: string) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      lead: true,
      transcripts: { orderBy: { timestamp: "asc" } },
      summary: true,
    },
  });
  if (!call) return;

  // If summary already exists (retry / partial finalize), still try booking once.
  if (call.summary) {
    const { attemptBookAppointmentFromCall } = await import(
      "@/services/voice-appointment-booking"
    );
    await attemptBookAppointmentFromCall({ callId: call.id });
    return;
  }

  // Lightweight post-call transcript normalization (no invented words).
  for (const row of call.transcripts) {
    const cleaned = normalizeTranscriptText(row.message);
    if (cleaned && cleaned !== row.message) {
      await prisma.callTranscript.update({
        where: { id: row.id },
        data: { message: cleaned.slice(0, 4000) },
      });
      row.message = cleaned;
    }
  }

  const transcript = call.transcripts.map((t) => ({
    speaker: t.speaker === "AI" ? "Agent" : "Lead",
    text: t.message,
  }));

  let summary;
  try {
    summary = await generateCallSummary({
      leadName: call.lead.name,
      companyName: call.lead.companyName,
      transcript,
    });
  } catch {
    summary = {
      summary: "Call completed. Automatic summary was unavailable.",
      outcome: "unknown" as const,
      interestLevel: "medium" as const,
      keyRequirements: [] as string[],
      painPoints: [] as string[],
      objections: [] as string[],
      nextAction: "Review the transcript and follow up manually.",
      followUpRecommended: true,
      preferredMeetingTime: "",
      appointmentActuallyBooked: false,
      appointmentOnlyProposed: false,
    };
  }

  // Prefer structured transcript intent + bookAppointment (not summary text alone).
  const { attemptBookAppointmentFromCall } = await import(
    "@/services/voice-appointment-booking"
  );
  const booking = await attemptBookAppointmentFromCall({
    callId: call.id,
    preferredTimeText: summary.preferredMeetingTime || undefined,
  });

  const appointmentActuallyBooked = booking.booked;
  const appointmentId = booking.appointmentId ?? null;
  const appointmentDateTime = booking.parsedStart
    ? new Date(booking.parsedStart)
    : null;
  const appointmentTimezone = booking.timezone ?? null;
  const appointmentStatus = booking.appointmentStatus;
  const preferredMeetingTime =
    booking.preferredText || summary.preferredMeetingTime || null;

  const appointmentOnlyProposed = Boolean(
    !appointmentActuallyBooked &&
      (preferredMeetingTime ||
        summary.appointmentOnlyProposed ||
        summary.outcome === "appointment_requested" ||
        booking.appointmentStatus === "proposed" ||
        booking.appointmentStatus === "awaiting_confirmation")
  );

  if (booking.appointmentStatus === "failed") {
    await prisma.activity
      .create({
        data: {
          companyId: call.companyId,
          leadId: call.leadId,
          userId: call.agentId,
          type: "APPOINTMENT_BOOKING_FAILED",
          description:
            "AI call preferred a meeting time but booking did not complete.",
        },
      })
      .catch(() => undefined);
  }

  const nextAction =
    appointmentActuallyBooked && appointmentDateTime && appointmentTimezone
      ? `${summary.nextAction} (Booked: ${appointmentDateTime.toISOString()} ${appointmentTimezone})`
      : appointmentOnlyProposed && preferredMeetingTime
        ? `${summary.nextAction} (Preferred time noted: ${preferredMeetingTime}; ${
            appointmentStatus === "failed" ? "booking failed" : "not auto-booked"
          }.)`
        : summary.nextAction;

  await prisma.$transaction([
    prisma.callSummary.upsert({
      where: { callId: call.id },
      create: {
        callId: call.id,
        summary: summary.summary,
        outcome: summary.outcome,
        interestLevel: summary.interestLevel,
        keyRequirements: summary.keyRequirements,
        painPoints: summary.painPoints,
        objectionList: summary.objections,
        objections: summary.objections.join("; ") || null,
        requirements: summary.keyRequirements.join("; ") || null,
        nextAction,
        followUpRecommended: summary.followUpRecommended,
        intent: summary.interestLevel,
        appointmentStatus,
        preferredMeetingTime,
        appointmentDateTime,
        appointmentTimezone,
        appointmentId,
      },
      update: {
        summary: summary.summary,
        outcome: summary.outcome,
        interestLevel: summary.interestLevel,
        keyRequirements: summary.keyRequirements,
        painPoints: summary.painPoints,
        objectionList: summary.objections,
        objections: summary.objections.join("; ") || null,
        requirements: summary.keyRequirements.join("; ") || null,
        nextAction,
        followUpRecommended: summary.followUpRecommended,
        intent: summary.interestLevel,
        appointmentStatus,
        preferredMeetingTime,
        appointmentDateTime,
        appointmentTimezone,
        appointmentId,
      },
    }),
    prisma.call.update({
      where: { id: call.id },
      data: {
        outcome: summary.outcome,
        qualificationScore:
          summary.interestLevel === "high"
            ? 85
            : summary.interestLevel === "medium"
              ? 65
              : 40,
      },
    }),
    prisma.activity.create({
      data: {
        companyId: call.companyId,
        leadId: call.leadId,
        userId: call.agentId,
        type: "AI_VOICE_CALL",
        description: appointmentActuallyBooked
          ? "AI sales call completed (appointment booked)"
          : appointmentOnlyProposed
            ? "AI sales call completed (preferred meeting time noted, not booked)"
            : "AI sales call completed",
      },
    }),
  ]);

  // Conservative lead updates only when evidence supports it
  const leadUpdate: Prisma.LeadUpdateInput = {};
  if (summary.outcome === "qualified") {
    leadUpdate.status = LeadStatus.QUALIFIED;
    leadUpdate.intent = "High";
  } else if (summary.outcome === "appointment_requested") {
    leadUpdate.status = LeadStatus.MEETING;
  } else if (summary.outcome === "callback_requested") {
    leadUpdate.status = LeadStatus.CONTACTED;
  } else if (summary.outcome === "not_interested") {
    leadUpdate.status = LeadStatus.LOST;
  } else if (call.lead.status === LeadStatus.NEW) {
    leadUpdate.status = LeadStatus.CONTACTED;
  }

  if (summary.interestLevel === "high" && call.lead.score < 80) {
    leadUpdate.score = Math.min(92, Math.max(call.lead.score, 80));
  }

  if (Object.keys(leadUpdate).length > 0) {
    await prisma.lead.update({
      where: { id: call.leadId },
      data: leadUpdate,
    });
  }

  // Phase 7: optional post-call / appointment confirmation email (non-blocking)
  if (call.agentId) {
    void import("@/services/email-automation")
      .then(({ maybeSendPostCallEmail }) =>
        maybeSendPostCallEmail({
          companyId: call.companyId,
          leadId: call.leadId,
          userId: call.agentId!,
          callId: call.id,
          appointmentBooked: appointmentActuallyBooked,
          appointmentId,
        })
      )
      .catch((error) => {
        console.error("[voice] post-call email automation failed", {
          callId: call.id,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
  }
}

function serializeCall(call: {
  id: string;
  leadId: string;
  status: CallStatus;
  phoneNumber: string | null;
  provider: string;
  providerCallId: string | null;
  voiceMode?: string | null;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  duration: number | null;
  outcome: string | null;
}) {
  return {
    id: call.id,
    leadId: call.leadId,
    status: call.status,
    phoneNumber: call.phoneNumber,
    provider: call.provider,
    providerCallId: call.providerCallId,
    voiceMode: call.voiceMode ?? "turn_based",
    startedAt: call.startedAt?.toISOString() ?? null,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    duration: call.duration,
    outcome: call.outcome,
  };
}

export { serializeCall, normalizePhone, mapTwilioStatus };
