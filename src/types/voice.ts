import { z } from "zod";

export const voiceTurnResultSchema = z.object({
  reply: z.string().min(1).max(1000),
  endCall: z.boolean(),
  handoffRequested: z.boolean().default(false),
  appointmentRequested: z.boolean().default(false),
  optOut: z.boolean().default(false),
});

export const callSummaryResultSchema = z.object({
  summary: z.string().min(1).max(4000),
  outcome: z.enum([
    "qualified",
    "not_interested",
    "callback_requested",
    "appointment_requested",
    "no_answer",
    "unknown",
  ]),
  interestLevel: z.enum(["low", "medium", "high"]),
  keyRequirements: z.array(z.string().min(1).max(200)).max(12).default([]),
  painPoints: z.array(z.string().min(1).max(200)).max(12).default([]),
  objections: z.array(z.string().min(1).max(200)).max(12).default([]),
  nextAction: z.string().min(1).max(500),
  followUpRecommended: z.boolean(),
  preferredMeetingTime: z.string().max(200).optional().default(""),
  appointmentActuallyBooked: z.boolean().optional().default(false),
  appointmentOnlyProposed: z.boolean().optional().default(false),
});

export const initiateVoiceCallRequestSchema = z.object({
  leadId: z.string().cuid(),
});

export type VoiceTurnResult = z.infer<typeof voiceTurnResultSchema>;
export type CallSummaryResult = z.infer<typeof callSummaryResultSchema>;

export const CALL_STATUS_LABELS: Record<string, string> = {
  INITIATING: "Calling…",
  RINGING: "Ringing…",
  IN_PROGRESS: "AI conversation active",
  CONNECTED: "Connected",
  COMPLETED: "Call completed",
  FAILED: "Call failed",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  CANCELED: "Canceled",
  SCHEDULED: "Scheduled",
};
