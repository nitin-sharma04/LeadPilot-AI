import type { VoiceLabScenarioId } from "./types.js";

export type VoiceLabScenario = {
  id: VoiceLabScenarioId;
  label: string;
  company: string;
  agentName: string;
  leadName: string;
  industry: string;
  context: string;
};

export const VOICE_LAB_SCENARIOS: VoiceLabScenario[] = [
  {
    id: "general_sdr",
    label: "A. General SDR",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Outbound intro call. Discover whether they want help generating more qualified leads. Local test persona only.",
  },
  {
    id: "real_estate",
    label: "B. Real estate",
    company: "Harbor Test Realty",
    agentName: "Alex",
    leadName: "Jordan Tester",
    industry: "Residential real estate",
    context:
      "You help listing agents get more seller conversations. Do not invent properties, prices, or neighborhoods.",
  },
  {
    id: "digital_agency",
    label: "C. Digital agency",
    company: "Pixel Test Agency",
    agentName: "Alex",
    leadName: "Riley Tester",
    industry: "Digital marketing",
    context:
      "You offer websites, SEO, and ads. Stay high-level unless they ask for detail. Do not invent case-study numbers.",
  },
  {
    id: "service_business",
    label: "D. Service business",
    company: "Summit Test Services",
    agentName: "Alex",
    leadName: "Casey Tester",
    industry: "Home services",
    context:
      "You help local service businesses book more jobs. Keep it practical. Do not invent technicians or service areas.",
  },
  {
    id: "appointment_booking",
    label: "E. Appointment booking",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Lead is already somewhat interested. Your job is to collect day and clock time, confirm once, then wait for yes. Booking is simulated only.",
  },
  {
    id: "objection_handling",
    label: "F. Objection handling",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Expect busy / send-me-something / not-interested. Acknowledge, stay brief, do not argue. Offer a next step only if they allow it.",
  },
  {
    id: "angry_impatient",
    label: "G. Angry / impatient lead",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Lead may be irritated. Stay calm, very short, no extra questions stacked. If they want to end, end.",
  },
  {
    id: "short_answer",
    label: "H. Short-answer lead",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Lead answers in a few words. Mirror that: one short sentence, one question max.",
  },
  {
    id: "talkative",
    label: "I. Talkative lead",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Lead may ramble. Do not cut them off in your wording. Respond to the latest point only.",
  },
  {
    id: "interrupting",
    label: "J. Interrupting lead",
    company: "Northwind Test Labs",
    agentName: "Alex",
    leadName: "Sam Tester",
    industry: "B2B software",
    context:
      "Lead may talk over you. When they speak, stop. Answer the new utterance only. Do not finish the old thought.",
  },
];

export const VOICE_LAB_TEST_LINES = [
  "Hi, who is this?",
  "I'm actually pretty busy right now.",
  "What exactly do you guys do?",
  "How much does it cost?",
  "Can you send me something first?",
  "I'm not really interested.",
  "Okay, tell me more.",
  "Yeah, that sounds interesting.",
  "Can we talk tomorrow?",
  "Tomorrow afternoon.",
  "Around 3 PM.",
  "Yeah, that works.",
  "Actually wait, make that 4 PM.",
  "Never mind.",
  "Okay thanks, bye.",
];

export function getVoiceLabScenario(id: string | undefined): VoiceLabScenario {
  return (
    VOICE_LAB_SCENARIOS.find((s) => s.id === id) || VOICE_LAB_SCENARIOS[0]
  );
}

export const VOICE_LAB_VAD_PRESETS = [
  650, 750, 850, 900, 950, 1000, 1100, 1200,
] as const;

export const VOICE_LAB_TTS_SPEEDS = [0.8, 0.9, 1, 1.1, 1.2] as const;

export const VOICE_LAB_EXPERIMENTS = [
  { id: "A", vadSilenceMs: 850, ttsSpeed: 0.95 },
  { id: "B", vadSilenceMs: 950, ttsSpeed: 0.9 },
  { id: "C", vadSilenceMs: 1050, ttsSpeed: 0.9 },
] as const;
