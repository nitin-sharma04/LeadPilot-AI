-- Phase 8: Lead Capture + CRM (additive, non-destructive)

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leadAutoAnalyzeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leadAutoAssignEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leadAutoFollowUpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leadAutoCallEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "leadAutoEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "defaultLeadOwnerId" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "defaultFollowUpSequenceId" TEXT;

-- Extend LeadSource enum
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WEB_FORM'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'CSV'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'HUBSPOT'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'SALESFORCE'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'META_ADS'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'OTHER'; EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Lead_email_idx" ON "Lead"("email");

DO $$ BEGIN CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT', 'SALESFORCE', 'DEMO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CrmConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'DEMO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LeadImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "LeadCaptureKey" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadCaptureKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadCaptureKey_keyHash_key" ON "LeadCaptureKey"("keyHash");
CREATE INDEX IF NOT EXISTS "LeadCaptureKey_companyId_idx" ON "LeadCaptureKey"("companyId");
CREATE INDEX IF NOT EXISTS "LeadCaptureKey_keyPrefix_idx" ON "LeadCaptureKey"("keyPrefix");

CREATE TABLE IF NOT EXISTS "WebhookEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "payloadHash" TEXT,
  "leadId" TEXT,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEvent_companyId_eventId_key" ON "WebhookEvent"("companyId", "eventId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_companyId_idx" ON "WebhookEvent"("companyId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_source_idx" ON "WebhookEvent"("source");

CREATE TABLE IF NOT EXISTS "LeadImport" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT,
  "filename" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "importedRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "failedRows" INTEGER NOT NULL DEFAULT 0,
  "status" "LeadImportStatus" NOT NULL DEFAULT 'PENDING',
  "errorSummary" TEXT,
  "mappingJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LeadImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeadImport_companyId_idx" ON "LeadImport"("companyId");
CREATE INDEX IF NOT EXISTS "LeadImport_status_idx" ON "LeadImport"("status");
CREATE INDEX IF NOT EXISTS "LeadImport_createdAt_idx" ON "LeadImport"("createdAt");

CREATE TABLE IF NOT EXISTS "CrmConnection" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "CrmProvider" NOT NULL,
  "status" "CrmConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "accountLabel" TEXT,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "tokenExpiry" TIMESTAMP(3),
  "scopes" TEXT NOT NULL DEFAULT '',
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrmConnection_companyId_provider_key" ON "CrmConnection"("companyId", "provider");
CREATE INDEX IF NOT EXISTS "CrmConnection_companyId_idx" ON "CrmConnection"("companyId");
CREATE INDEX IF NOT EXISTS "CrmConnection_status_idx" ON "CrmConnection"("status");

CREATE TABLE IF NOT EXISTS "LeadExternalIdentity" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "provider" "CrmProvider" NOT NULL,
  "externalId" TEXT NOT NULL,
  "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeadExternalIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadExternalIdentity_companyId_provider_externalId_key" ON "LeadExternalIdentity"("companyId", "provider", "externalId");
CREATE INDEX IF NOT EXISTS "LeadExternalIdentity_leadId_idx" ON "LeadExternalIdentity"("leadId");
CREATE INDEX IF NOT EXISTS "LeadExternalIdentity_companyId_idx" ON "LeadExternalIdentity"("companyId");

DO $$ BEGIN ALTER TABLE "LeadCaptureKey" ADD CONSTRAINT "LeadCaptureKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LeadCaptureKey" ADD CONSTRAINT "LeadCaptureKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LeadImport" ADD CONSTRAINT "LeadImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LeadExternalIdentity" ADD CONSTRAINT "LeadExternalIdentity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "LeadExternalIdentity" ADD CONSTRAINT "LeadExternalIdentity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
