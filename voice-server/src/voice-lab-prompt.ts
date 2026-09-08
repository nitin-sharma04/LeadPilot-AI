import { REALTIME_HUMAN_SDR_PROMPT } from "./prompts.js";
import {
  REALTIME_HUMAN_SDR_LAB_PROMPT,
  type VoiceLabPromptVariant,
} from "../../voice-lab/lab-prompt.js";
import type { VoiceLabScenario } from "../../voice-lab/scenarios.js";

const LAB_SUFFIX = (scenario: VoiceLabScenario) => `

LOCAL VOICE LAB — this is a simulated conversation on a computer, not a phone call and not Twilio.
Test company: ${scenario.company}
You are ${scenario.agentName}. Address the lead as ${scenario.leadName.split(" ")[0]} when natural.
Industry: ${scenario.industry}
Scenario: ${scenario.context}

BOOKING IS SIMULATED:
- Never say you sent a calendar invite, email, or SMS.
- Never say this is on a real calendar.
- After [INTERNAL] booking_ok, acknowledge the test booking in one short sentence and say no invite was sent.
- On [INTERNAL] booking_fail, ask for another time.

Do not mention LeadPilot internals, WebSockets, or that this is a lab unless asked.`;

/** Only the base prompt differs between variants; scenario/booking suffix is identical. */
export function buildVoiceLabSystemInstruction(
  scenario: VoiceLabScenario,
  variant: VoiceLabPromptVariant = "lab"
): string {
  const base =
    variant === "production"
      ? REALTIME_HUMAN_SDR_PROMPT
      : REALTIME_HUMAN_SDR_LAB_PROMPT;
  return `${base}${LAB_SUFFIX(scenario)}`;
}
