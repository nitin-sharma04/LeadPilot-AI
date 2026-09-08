/**
 * Local/test-only Twilio-like delay. Always disabled when NODE_ENV=production.
 * Used by Voice Lab and unit tests — never imported into the live phone path
 * as a speech generator.
 */
import {
  getVoiceLabJitterMs,
  getVoiceLabNetworkDelayMs,
} from "./config.js";
import type { VoiceLabLatencyProfile } from "../../voice-lab/config.js";

export function resolveNetworkSimDelayMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const base = getVoiceLabNetworkDelayMs(env);
  const jitter = getVoiceLabJitterMs(env);
  if (base <= 0 && jitter <= 0) return 0;
  const spread = jitter > 0 ? Math.floor(Math.random() * (jitter + 1)) : 0;
  return base + spread;
}

export function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function maybeSimulateNetworkDelay(
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const ms = resolveNetworkSimDelayMs(env);
  if (ms > 0) await delay(ms);
  return ms;
}

/** Lab-only: delay using a session latency profile. No-op in production. */
export async function applyLabLatencyMs(
  ms: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if ((env.NODE_ENV || "").trim().toLowerCase() === "production") return;
  if (ms > 0) await delay(ms);
}

export function labInboundDelayMs(
  profile: VoiceLabLatencyProfile | null
): number {
  if (!profile) return 0;
  const jitter = profile.jitterMs
    ? Math.floor(Math.random() * (profile.jitterMs + 1))
    : 0;
  return profile.inboundMs + jitter;
}
