export type VoiceCallStatus =
  | "initiating"
  | "ringing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "busy"
  | "canceled";

export type InitiateVoiceCallInput = {
  callId: string;
  toPhoneNumber: string;
};

export type InitiateVoiceCallResult = {
  provider: string;
  providerCallId: string;
  status: string;
};

export interface VoiceProvider {
  readonly id: string;
  readonly displayName: string;
  initiateOutboundCall(
    input: InitiateVoiceCallInput
  ): Promise<InitiateVoiceCallResult>;
}
