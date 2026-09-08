import { claimsPrematureBooking } from "../voice-server/src/tts/spoken-guard.js";
import { detectsAgentFarewell } from "../voice-server/src/end-call-intent.js";
import { countWords } from "./config.js";

export function validateLabAgentReply(input: {
  userText: string;
  agentText: string;
  hasSimulatedBook: boolean;
}): string[] {
  const issues: string[] = [];
  const agent = input.agentText.replace(/\s+/g, " ").trim();
  const user = input.userText.replace(/\s+/g, " ").trim();
  if (!agent) {
    issues.push("Empty AI response after a finalized user turn.");
    return issues;
  }
  const questions = (agent.match(/\?/g) || []).length;
  if (questions > 1) issues.push("Asked more than one question.");
  if (countWords(agent) > 22) issues.push("Response longer than ~22 spoken words.");
  if (/^(got it|absolutely|perfect|great|certainly)\b/i.test(agent)) {
    issues.push("Starts with a canned filler.");
  }
  if (user.length > 12 && agent.toLowerCase().includes(user.toLowerCase())) {
    issues.push("Mechanically restates the user.");
  }
  if (!input.hasSimulatedBook && claimsPrematureBooking(agent)) {
    issues.push("Claimed a booking/invite without simulated confirmation.");
  }
  if (
    /\b(i('?ll| will) send (over )?(an |the )?(calendar )?invite)\b/i.test(agent)
  ) {
    issues.push("Claimed a real calendar invite (lab must not).");
  }
  if (detectsAgentFarewell(agent) && questions > 0) {
    issues.push("Farewell still asked a question.");
  }
  return issues;
}
