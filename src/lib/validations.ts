import { z } from "zod";
import {
  AppointmentStatus,
  FollowUpStatus,
  LeadSource,
  LeadStatus,
} from "@prisma/client";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signupSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  companyName: z.string().min(2, "Company name is required"),
});

export const createLeadSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().optional(),
  companyName: z.string().min(1, "Company is required"),
  jobTitle: z.string().optional(),
  industry: z.string().optional(),
  source: z.nativeEnum(LeadSource).default(LeadSource.MANUAL),
  message: z.string().optional(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  score: z.number().int().min(0).max(100).optional(),
  intent: z.string().optional(),
  urgency: z.string().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  dealValue: z.number().int().min(0).optional(),
  assignedToId: z.string().cuid().optional().nullable(),
});

export const updateLeadSchema = createLeadSchema.partial();

export const updateLeadStatusSchema = z.object({
  status: z.nativeEnum(LeadStatus),
});

export const markNotificationSchema = z.object({
  read: z.boolean(),
});

export const createAppointmentSchema = z.object({
  leadId: z.string().cuid(),
  title: z.string().min(2),
  dateTime: z.string().datetime(),
  duration: z.number().int().min(15).max(480).optional(),
  timezone: z.string().min(1).max(64).default("UTC"),
  notes: z.string().optional(),
  assignedToId: z.string().cuid().optional().nullable(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  syncCalendar: z.boolean().optional(),
});

export const updateAppointmentSchema = z.object({
  action: z.enum(["reschedule", "cancel"]),
  startTime: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  timezone: z.string().min(1).max(64).optional(),
  notes: z.string().optional(),
});

export const updateFollowUpSchema = z.object({
  status: z.nativeEnum(FollowUpStatus),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
