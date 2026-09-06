/**
 * Realtime call hangup lifecycle verification (no live Twilio call required).
 * Run: npx tsx scripts/verify-call-hangup.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { CallEndController } from "../voice-server/src/call-end-controller";
import { getMaxCallDurationSeconds } from "../voice-server/src/config";
import {
  detectsAgentFarewell,
  detectsEndCallIntent,
  detectsForceHangupIntent,
} from "../voice-server/src/end-call-intent";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // --- Intent coverage ---
  assert(detectsEndCallIntent("hang up"), "A/B hang up");
  assert(detectsEndCallIntent("please hang up"), "please hang up");
  assert(detectsEndCallIntent("end the call"), "end the call");
  assert(detectsEndCallIntent("goodbye"), "goodbye");
  assert(detectsEndCallIntent("bye"), "bye");
  assert(detectsEndCallIntent("I have to go"), "have to go");
  assert(detectsEndCallIntent("that's all"), "thats all");
  assert(detectsEndCallIntent("that's all I needed"), "thats all needed");
  assert(detectsEndCallIntent("thanks, bye"), "thanks bye");
  assert(detectsEndCallIntent("we're done"), "were done");
  assert(detectsEndCallIntent("stop the call"), "stop the call");
  assert(
    detectsForceHangupIntent("Why aren't you hanging up?"),
    "force hangup"
  );
  assert(
    detectsForceHangupIntent("Why are you still on the call?"),
    "still on call"
  );
  assert(
    detectsForceHangupIntent("Why haven't you hung up?"),
    "havent hung up"
  );
  assert(detectsForceHangupIntent("You can hang up now."), "hang up now");
  assert(
    detectsEndCallIntent("Why haven't you hung up?"),
    "force counts as end"
  );
  assert(
    !detectsEndCallIntent("Can you tell me more about pricing?"),
    "I normal conversation unchanged"
  );

  assert(
    detectsAgentFarewell("Thanks for your time, Sarah. Have a great day."),
    "A agent farewell"
  );
  assert(
    !detectsAgentFarewell("Have a great day — do you have a quick moment?"),
    "opening with question is not farewell"
  );

  // --- Controller: agent farewell → hangup after mark ---
  {
    let hangupCalls = 0;
    const c = new CallEndController({
      callId: "c-agent",
      getProviderCallSid: () => "CAxxxx",
      hangupTwilio: async () => {
        hangupCalls += 1;
        return { ok: true, status: 200 };
      },
      markFallbackMs: 5000,
    });

    const first = c.requestEnd({
      reason: "agent_farewell",
      awaitFarewellDelivery: true,
    });
    assert(first.accepted, "A request accepted");
    assert(c.isEnding, "A ending");
    assert(c.shouldAcceptGeminiInput === false, "E no gemini input after end");
    assert(
      c.shouldAcceptOutboundAudio === true,
      "F farewell audio still allowed"
    );

    c.notifyFarewellEnqueued("m3");
    assert(hangupCalls === 0, "F hangup waits for mark");
    c.onTwilioMark("m2");
    assert(hangupCalls === 0, "F wrong mark ignored");
    c.onTwilioMark("m3");
    await sleep(20);
    assert(hangupCalls === 1, "A Twilio endCall invoked after farewell mark");
    assert(c.isTerminated, "terminated");
    assert(c.shouldAcceptOutboundAudio === false, "E no audio after hangup");
  }

  // --- Lead hang up ---
  {
    let hangupCalls = 0;
    const c = new CallEndController({
      callId: "c-lead",
      getProviderCallSid: () => "CAlead",
      hangupTwilio: async () => {
        hangupCalls += 1;
        return { ok: true };
      },
      markFallbackMs: 5000,
    });
    c.requestEnd({ reason: "lead_hangup", awaitFarewellDelivery: true });
    c.notifyFarewellEnqueued("m1");
    c.onTwilioMark("m1");
    await sleep(20);
    assert(hangupCalls === 1, "B lead hangup invokes Twilio");
  }

  // --- Force hangup ---
  {
    let hangupCalls = 0;
    const c = new CallEndController({
      callId: "c-force",
      getProviderCallSid: () => "CAforce",
      hangupTwilio: async () => {
        hangupCalls += 1;
        return { ok: true };
      },
      markFallbackMs: 5000,
    });
    c.requestEnd({ reason: "lead_force_hangup", awaitFarewellDelivery: true });
    c.notifyFarewellEnqueued("m9");
    c.onTwilioMark("m9");
    await sleep(20);
    assert(hangupCalls === 1, "C force hangup invokes Twilio");
  }

  // --- Idempotent double endCall ---
  {
    let hangupCalls = 0;
    const c = new CallEndController({
      callId: "c-idem",
      getProviderCallSid: () => "CAidem",
      hangupTwilio: async () => {
        hangupCalls += 1;
        return { ok: true };
      },
      markFallbackMs: 50,
    });
    assert(
      c.requestEnd({ reason: "lead_hangup", awaitFarewellDelivery: false })
        .accepted,
      "D first accepted"
    );
    assert(
      c.requestEnd({ reason: "lead_hangup", awaitFarewellDelivery: false })
        .accepted === false,
      "D second rejected"
    );
    await sleep(80);
    assert(hangupCalls === 1, "D only one Twilio termination");
    await c.forceHangupNow("stream_stop");
    assert(hangupCalls === 1, "D forceHangup after terminate is no-op on Twilio");
  }

  // --- Hangup API failure does not pretend success ---
  {
    const c = new CallEndController({
      callId: "c-fail",
      getProviderCallSid: () => "CAfail",
      hangupTwilio: async () => ({
        ok: false,
        status: 500,
        errorType: "provider_error",
      }),
      markFallbackMs: 10,
    });
    c.requestEnd({ reason: "lead_hangup", awaitFarewellDelivery: false });
    const result = await c.forceHangupNow("lead_hangup");
    assert(result.ok === false, "G hangup failure reported");
    assert(c.isTerminated, "G controller finished attempt");
  }

  // --- Max duration immediate hangup ---
  {
    let hangupCalls = 0;
    const c = new CallEndController({
      callId: "c-max",
      getProviderCallSid: () => "CAmax",
      hangupTwilio: async () => {
        hangupCalls += 1;
        return { ok: true };
      },
    });
    c.requestEnd({ reason: "max_duration", awaitFarewellDelivery: false });
    await sleep(30);
    assert(hangupCalls === 1, "H max duration terminates call");
    assert(c.endReason === "max_duration", "H reason recorded");
  }

  assert(getMaxCallDurationSeconds() >= 60, "H max duration config");

  // --- Source wiring ---
  const bridge = readFileSync(
    path.join(process.cwd(), "voice-server/src/twilio-stream-handler.ts"),
    "utf8"
  );
  assert(bridge.includes("CallEndController"), "wired controller");
  assert(bridge.includes('event === "mark"'), "listens for Twilio marks");
  assert(bridge.includes("completeTwilioCall"), "uses Twilio REST hangup");
  assert(bridge.includes("getMaxCallDurationSeconds"), "max duration timer");
  assert(bridge.includes("detectsAgentFarewell"), "agent farewell path");
  assert(bridge.includes("pauseInput"), "stops gemini input on end");

  const hangupSrc = readFileSync(
    path.join(process.cwd(), "voice-server/src/twilio-hangup.ts"),
    "utf8"
  );
  assert(hangupSrc.includes('Status: "completed"'), "Status=completed");
  assert(hangupSrc.includes("endCall"), "endCall helper");

  const clientSrc = readFileSync(
    path.join(process.cwd(), "src/lib/voice/twilio-client.ts"),
    "utf8"
  );
  assert(clientSrc.includes("endTwilioCall"), "Next.js endTwilioCall helper");

  const envExample = readFileSync(
    path.join(process.cwd(), ".env.example"),
    "utf8"
  );
  assert(
    envExample.includes("VOICE_MAX_CALL_DURATION_SECONDS"),
    "env example max duration"
  );

  console.log("Call hangup verification passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
