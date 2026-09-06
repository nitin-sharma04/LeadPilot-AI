-- Phase 7: AI Email & Follow-up Automation
-- Non-destructive additive migration

-- Company email automation settings
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailAutomationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailAutoSendEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailAppointmentConfirmEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailFollowUpSequencesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailPostCallEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "emailHumanApprovalRequired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "defaultEmailAccountId" TEXT;

-- Lead opt-out
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "emailOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "emailOptOutAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Lead_emailOptOut_idx" ON "Lead"("emailOptOut");

-- Enums
DO $$ BEGIN
  CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'DEMO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailAccountStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'DEMO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailDirection" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailMessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'RECEIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailType" AS ENUM ('INTRO', 'FOLLOW_UP', 'POST_CALL', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'POST_MEETING', 'RE_ENGAGEMENT', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmailTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'CONCISE', 'CONSULTATIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SequenceEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SequenceStopReason" AS ENUM ('REPLIED', 'BOOKED', 'CLOSED', 'MANUAL', 'UNSUBSCRIBED', 'FAILED', 'OPTED_OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EmailAccount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "EmailProvider" NOT NULL DEFAULT 'GMAIL',
  "emailAddress" TEXT NOT NULL,
  "displayName" TEXT,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "tokenExpiry" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT '',
  "status" "EmailAccountStatus" NOT NULL DEFAULT 'CONNECTED',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailAccount_companyId_userId_provider_key" ON "EmailAccount"("companyId", "userId", "provider");
CREATE INDEX IF NOT EXISTS "EmailAccount_companyId_idx" ON "EmailAccount"("companyId");
CREATE INDEX IF NOT EXISTS "EmailAccount_userId_idx" ON "EmailAccount"("userId");
CREATE INDEX IF NOT EXISTS "EmailAccount_status_idx" ON "EmailAccount"("status");

CREATE TABLE IF NOT EXISTS "FollowUpSequence" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FollowUpSequence_companyId_idx" ON "FollowUpSequence"("companyId");
CREATE INDEX IF NOT EXISTS "FollowUpSequence_isActive_idx" ON "FollowUpSequence"("isActive");

CREATE TABLE IF NOT EXISTS "FollowUpStep" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL,
  "delayDays" INTEGER NOT NULL DEFAULT 0,
  "emailType" "EmailType" NOT NULL DEFAULT 'FOLLOW_UP',
  "tone" "EmailTone" NOT NULL DEFAULT 'PROFESSIONAL',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "subjectHint" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpStep_sequenceId_stepOrder_key" ON "FollowUpStep"("sequenceId", "stepOrder");
CREATE INDEX IF NOT EXISTS "FollowUpStep_sequenceId_idx" ON "FollowUpStep"("sequenceId");

CREATE TABLE IF NOT EXISTS "FollowUpEnrollment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "status" "SequenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentStepOrder" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "stopReason" "SequenceStopReason",
  "processingLock" TEXT,
  "processingUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FollowUpEnrollment_companyId_idx" ON "FollowUpEnrollment"("companyId");
CREATE INDEX IF NOT EXISTS "FollowUpEnrollment_leadId_idx" ON "FollowUpEnrollment"("leadId");
CREATE INDEX IF NOT EXISTS "FollowUpEnrollment_sequenceId_idx" ON "FollowUpEnrollment"("sequenceId");
CREATE INDEX IF NOT EXISTS "FollowUpEnrollment_status_idx" ON "FollowUpEnrollment"("status");
CREATE INDEX IF NOT EXISTS "FollowUpEnrollment_nextRunAt_idx" ON "FollowUpEnrollment"("nextRunAt");

CREATE TABLE IF NOT EXISTS "EmailMessage" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "userId" TEXT,
  "direction" "EmailDirection" NOT NULL DEFAULT 'OUTBOUND',
  "emailType" "EmailType",
  "tone" "EmailTone",
  "providerMessageId" TEXT,
  "threadId" TEXT,
  "toAddress" TEXT NOT NULL,
  "ccAddress" TEXT,
  "bccAddress" TEXT,
  "subject" TEXT NOT NULL,
  "bodyText" TEXT NOT NULL,
  "bodyHtml" TEXT,
  "status" "EmailMessageStatus" NOT NULL DEFAULT 'DRAFT',
  "idempotencyKey" TEXT,
  "errorMessage" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "enrollmentId" TEXT,
  "stepId" TEXT,
  "sentAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_companyId_idempotencyKey_key" ON "EmailMessage"("companyId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "EmailMessage_companyId_idx" ON "EmailMessage"("companyId");
CREATE INDEX IF NOT EXISTS "EmailMessage_leadId_idx" ON "EmailMessage"("leadId");
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_idx" ON "EmailMessage"("threadId");
CREATE INDEX IF NOT EXISTS "EmailMessage_status_idx" ON "EmailMessage"("status");
CREATE INDEX IF NOT EXISTS "EmailMessage_createdAt_idx" ON "EmailMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "EmailMessage_enrollmentId_idx" ON "EmailMessage"("enrollmentId");

-- FKs (ignore if already present)
DO $$ BEGIN
  ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpStep" ADD CONSTRAINT "FollowUpStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpEnrollment" ADD CONSTRAINT "FollowUpEnrollment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpEnrollment" ADD CONSTRAINT "FollowUpEnrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpEnrollment" ADD CONSTRAINT "FollowUpEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FollowUpEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
