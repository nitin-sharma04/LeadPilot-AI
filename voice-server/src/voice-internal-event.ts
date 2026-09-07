/**
 * Internal runtime events for Gemini coaching / booking — never user-facing speech.
 */

export type VoiceInternalEventType =
  | "appointment_booking_succeeded"
  | "appointment_booking_failed"
  | "appointment_coaching"
  | "speech_pace"
  | "call_end_requested";

export type VoiceInternalEvent = {
  type: VoiceInternalEventType;
  payload?: Record<string, unknown>;
};
