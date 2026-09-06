import { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { initiateVoiceCallRequestSchema } from "@/types/voice";
import { initiateAiVoiceCall } from "@/services/voice-calls";
import { jsonError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession();
    const body = await request.json();
    const parsed = initiateVoiceCallRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const call = await initiateAiVoiceCall(user, parsed.data.leadId);
    return Response.json({ success: true, call });
  } catch (error) {
    return jsonError(
      error,
      "Unable to start an AI call right now. Please try again."
    );
  }
}
