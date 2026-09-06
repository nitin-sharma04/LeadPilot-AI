-- Phase 5B: realtime voice mode fields
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "voiceMode" TEXT NOT NULL DEFAULT 'turn_based';
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "streamToken" TEXT;
