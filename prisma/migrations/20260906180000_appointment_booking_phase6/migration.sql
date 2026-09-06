-- Phase 6: Appointment booking + Google Calendar

DO $$ BEGIN
  CREATE TYPE "AppointmentSource" AS ENUM ('MANUAL', 'AI_CALL', 'WEB');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "callId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "externalEventId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "calendarProvider" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CallSummary" ADD COLUMN IF NOT EXISTS "appointmentStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "CallSummary" ADD COLUMN IF NOT EXISTS "preferredMeetingTime" TEXT;
ALTER TABLE "CallSummary" ADD COLUMN IF NOT EXISTS "appointmentDateTime" TIMESTAMP(3);
ALTER TABLE "CallSummary" ADD COLUMN IF NOT EXISTS "appointmentTimezone" TEXT;
ALTER TABLE "CallSummary" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;

CREATE TABLE IF NOT EXISTS "GoogleCalendarConnection" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "googleEmail" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "expiryDate" TIMESTAMP(3) NOT NULL,
  "scope" TEXT NOT NULL DEFAULT '',
  "calendarId" TEXT NOT NULL DEFAULT 'primary',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleCalendarConnection_userId_key" ON "GoogleCalendarConnection"("userId");
CREATE INDEX IF NOT EXISTS "GoogleCalendarConnection_companyId_idx" ON "GoogleCalendarConnection"("companyId");

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_companyId_idempotencyKey_key" ON "Appointment"("companyId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "Appointment_callId_idx" ON "Appointment"("callId");
CREATE INDEX IF NOT EXISTS "Appointment_status_idx" ON "Appointment"("status");
CREATE INDEX IF NOT EXISTS "CallSummary_appointmentId_idx" ON "CallSummary"("appointmentId");

DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_callId_fkey"
    FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CallSummary" ADD CONSTRAINT "CallSummary_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "GoogleCalendarConnection" ADD CONSTRAINT "GoogleCalendarConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
