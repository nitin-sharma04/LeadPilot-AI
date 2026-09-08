import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isVoiceLabEnabled } from "../../../voice-lab/config";
import { VoiceLabClient } from "./voice-lab-client";

export const metadata: Metadata = {
  title: "Local Voice Lab",
};

export const dynamic = "force-dynamic";

export default function VoiceLabPage() {
  if (!isVoiceLabEnabled()) notFound();
  const wsUrl =
    process.env.NEXT_PUBLIC_VOICE_LAB_WS_URL || "ws://127.0.0.1:8081/voice-lab";
  return <VoiceLabClient wsUrl={wsUrl} />;
}
