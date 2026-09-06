-- CreateEnum
CREATE TYPE "SalesResponseType" AS ENUM ('INITIAL_OUTREACH', 'FOLLOW_UP', 'RE_ENGAGEMENT', 'MEETING_CONFIRMATION', 'PROPOSAL_FOLLOW_UP', 'GENERAL');

-- CreateEnum
CREATE TYPE "SalesResponseTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'CONSULTATIVE', 'DIRECT', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SalesResponseChannel" AS ENUM ('EMAIL', 'MESSAGE');

-- CreateTable
CREATE TABLE "GeneratedResponse" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "SalesResponseChannel" NOT NULL,
    "responseType" "SalesResponseType" NOT NULL,
    "tone" "SalesResponseTone" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "callToAction" TEXT NOT NULL,
    "personalizationNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedResponse_companyId_idx" ON "GeneratedResponse"("companyId");

-- CreateIndex
CREATE INDEX "GeneratedResponse_leadId_idx" ON "GeneratedResponse"("leadId");

-- CreateIndex
CREATE INDEX "GeneratedResponse_createdAt_idx" ON "GeneratedResponse"("createdAt");

-- AddForeignKey
ALTER TABLE "GeneratedResponse" ADD CONSTRAINT "GeneratedResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedResponse" ADD CONSTRAINT "GeneratedResponse_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedResponse" ADD CONSTRAINT "GeneratedResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
