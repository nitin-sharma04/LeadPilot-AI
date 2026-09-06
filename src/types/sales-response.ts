import { z } from "zod";

export const salesResponseTypeSchema = z.enum([
  "initial_outreach",
  "follow_up",
  "re_engagement",
  "meeting_confirmation",
  "proposal_follow_up",
  "general",
]);

export const salesResponseToneSchema = z.enum([
  "professional",
  "friendly",
  "consultative",
  "direct",
  "premium",
]);

export const salesResponseChannelSchema = z.enum(["email", "message"]);

export const generateSalesResponseRequestSchema = z.object({
  leadId: z.string().cuid(),
  responseType: salesResponseTypeSchema,
  tone: salesResponseToneSchema,
  channel: salesResponseChannelSchema,
});

export const salesResponseResultSchema = z
  .object({
    channel: salesResponseChannelSchema,
    subject: z.string().max(200).nullable(),
    body: z.string().min(1).max(8000),
    callToAction: z.string().min(1).max(500),
    personalizationNotes: z.array(z.string().min(1).max(300)).max(8).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.channel === "email") {
      const subject = value.subject?.trim() ?? "";
      if (!subject) {
        ctx.addIssue({
          code: "custom",
          path: ["subject"],
          message: "Email responses require a subject",
        });
      }
    }
  });

export const updateGeneratedResponseSchema = z.object({
  subject: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(8000).optional(),
  callToAction: z.string().min(1).max(500).optional(),
});

export type SalesResponseType = z.infer<typeof salesResponseTypeSchema>;
export type SalesResponseTone = z.infer<typeof salesResponseToneSchema>;
export type SalesResponseChannel = z.infer<typeof salesResponseChannelSchema>;
export type SalesResponseResult = z.infer<typeof salesResponseResultSchema>;
export type GenerateSalesResponseRequest = z.infer<
  typeof generateSalesResponseRequestSchema
>;

export const RESPONSE_TYPE_LABELS: Record<SalesResponseType, string> = {
  initial_outreach: "Initial Outreach",
  follow_up: "Follow-up",
  re_engagement: "Re-engagement",
  meeting_confirmation: "Meeting Confirmation",
  proposal_follow_up: "Proposal Follow-up",
  general: "General Sales Response",
};

export const TONE_LABELS: Record<SalesResponseTone, string> = {
  professional: "Professional",
  friendly: "Friendly",
  consultative: "Consultative",
  direct: "Direct",
  premium: "Premium",
};

export const CHANNEL_LABELS: Record<SalesResponseChannel, string> = {
  email: "Email",
  message: "Short Message",
};

/** Map API snake_case values ↔ Prisma enums */
export function toPrismaResponseType(value: SalesResponseType) {
  const map = {
    initial_outreach: "INITIAL_OUTREACH",
    follow_up: "FOLLOW_UP",
    re_engagement: "RE_ENGAGEMENT",
    meeting_confirmation: "MEETING_CONFIRMATION",
    proposal_follow_up: "PROPOSAL_FOLLOW_UP",
    general: "GENERAL",
  } as const;
  return map[value];
}

export function toPrismaTone(value: SalesResponseTone) {
  const map = {
    professional: "PROFESSIONAL",
    friendly: "FRIENDLY",
    consultative: "CONSULTATIVE",
    direct: "DIRECT",
    premium: "PREMIUM",
  } as const;
  return map[value];
}

export function toPrismaChannel(value: SalesResponseChannel) {
  return value === "email" ? "EMAIL" : "MESSAGE";
}

export function fromPrismaResponseType(
  value: string
): SalesResponseType | null {
  const map: Record<string, SalesResponseType> = {
    INITIAL_OUTREACH: "initial_outreach",
    FOLLOW_UP: "follow_up",
    RE_ENGAGEMENT: "re_engagement",
    MEETING_CONFIRMATION: "meeting_confirmation",
    PROPOSAL_FOLLOW_UP: "proposal_follow_up",
    GENERAL: "general",
  };
  return map[value] ?? null;
}

export function fromPrismaTone(value: string): SalesResponseTone | null {
  const map: Record<string, SalesResponseTone> = {
    PROFESSIONAL: "professional",
    FRIENDLY: "friendly",
    CONSULTATIVE: "consultative",
    DIRECT: "direct",
    PREMIUM: "premium",
  };
  return map[value] ?? null;
}

export function fromPrismaChannel(value: string): SalesResponseChannel | null {
  if (value === "EMAIL") return "email";
  if (value === "MESSAGE") return "message";
  return null;
}
