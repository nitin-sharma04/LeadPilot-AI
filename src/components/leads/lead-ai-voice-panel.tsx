"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { CALL_STATUS_LABELS } from "@/types/voice";

/** Normalize/validate to E.164 for save + outbound calls. */
function normalizeE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+") && digits.length >= 11 && digits.length <= 16) {
    return digits;
  }
  const only = digits.replace(/\D/g, "");
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith("1")) return `+${only}`;
  if (only.length >= 10 && only.length <= 15) return `+${only}`;
  return null;
}

export type VoiceCallSnapshot = {
  id: string;
  status: string;
  phoneNumber: string | null;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;
  outcome: string | null;
  voiceMode?: string | null;
  agentName?: string;
};

type LeadAiVoicePanelProps = {
  leadId: string;
  phone: string | null;
  agentName: string;
  previousCallCount: number;
  lastCall: VoiceCallSnapshot | null;
};

type LiveCall = {
  id: string;
  status: string;
  statusLabel?: string;
  phoneNumber?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration?: number | null;
  outcome?: string | null;
  voiceMode?: string | null;
  aiProvider?: string | null;
  transcripts?: Array<{
    id: string;
    speaker: string;
    text: string;
    timestamp: string;
  }>;
  summary?: {
    summary: string;
    outcome: string | null;
    interestLevel: string | null;
    keyRequirements: string[];
    painPoints: string[];
    objections: string[];
    nextAction: string | null;
    followUpRecommended: boolean;
  } | null;
};

const ACTIVE = new Set([
  "INITIATING",
  "RINGING",
  "IN_PROGRESS",
  "CONNECTED",
]);

export function LeadAiVoicePanel({
  leadId,
  phone,
  agentName,
  previousCallCount,
  lastCall,
}: LeadAiVoicePanelProps) {
  const router = useRouter();
  const [currentPhone, setCurrentPhone] = useState(phone?.trim() || "");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(phone?.trim() || "");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveCall | null>(
    lastCall
      ? {
          id: lastCall.id,
          status: lastCall.status,
          statusLabel: CALL_STATUS_LABELS[lastCall.status],
          phoneNumber: lastCall.phoneNumber,
          startedAt: lastCall.startedAt,
          endedAt: lastCall.endedAt,
          duration: lastCall.duration,
          outcome: lastCall.outcome,
          voiceMode: lastCall.voiceMode ?? "turn_based",
        }
      : null
  );

  useEffect(() => {
    setCurrentPhone(phone?.trim() || "");
    if (!editingPhone) {
      setPhoneDraft(phone?.trim() || "");
    }
  }, [phone, editingPhone]);

  const refreshCall = useCallback(async (callId: string) => {
    const res = await fetch(`/api/voice/calls/${callId}`);
    const json = await res.json();
    if (!res.ok || !json.success) return null;
    setLive(json.call);
    return json.call as LiveCall;
  }, []);

  useEffect(() => {
    if (!live?.id || !ACTIVE.has(live.status)) return;
    const timer = window.setInterval(() => {
      void refreshCall(live.id);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [live?.id, live?.status, refreshCall]);

  function startEditPhone() {
    setPhoneDraft(currentPhone);
    setPhoneError(null);
    setEditingPhone(true);
  }

  function cancelEditPhone() {
    setPhoneDraft(currentPhone);
    setPhoneError(null);
    setEditingPhone(false);
  }

  async function savePhone() {
    if (savingPhone) return;
    const normalized = normalizeE164(phoneDraft);
    if (!normalized) {
      const message =
        "Enter a valid phone number in E.164 format (e.g. +919876543210).";
      setPhoneError(message);
      toast.error(message);
      return;
    }

    setSavingPhone(true);
    setPhoneError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Unable to save phone number.");
      }
      const saved =
        typeof json.data?.phone === "string" && json.data.phone.trim()
          ? json.data.phone.trim()
          : normalized;
      setCurrentPhone(saved);
      setPhoneDraft(saved);
      setEditingPhone(false);
      toast.success("Phone number updated.");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to save phone number.";
      setPhoneError(message);
      toast.error(message);
    } finally {
      setSavingPhone(false);
    }
  }

  async function handleCall() {
    if (starting) return;
    if (!currentPhone.trim()) {
      const message = "This lead does not have a phone number.";
      setError(message);
      toast.error(message);
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/voice/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to start AI call.");
      }
      setLive({
        id: json.call.id,
        status: json.call.status,
        statusLabel: CALL_STATUS_LABELS[json.call.status],
        phoneNumber: json.call.phoneNumber,
        startedAt: json.call.startedAt,
        voiceMode: json.call.voiceMode,
      });
      toast.success(
        json.call.voiceMode === "realtime"
          ? "Realtime AI call initiated."
          : "Turn-based AI call initiated."
      );
      await refreshCall(json.call.id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to start AI call.";
      setError(message);
      toast.error(message);
    } finally {
      setStarting(false);
    }
  }

  const statusLabel =
    live?.statusLabel ||
    (live ? CALL_STATUS_LABELS[live.status] : null) ||
    "No active call";

  const callBusy = live ? ACTIVE.has(live.status) : false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <CardTitle>AI Voice Agent</CardTitle>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Manual outbound qualification call via Twilio + AI
            </p>
          </div>
          <Button
            onClick={handleCall}
            disabled={
              starting ||
              savingPhone ||
              editingPhone ||
              !currentPhone ||
              callBusy
            }
            aria-busy={starting}
          >
            {starting
              ? "Starting…"
              : callBusy
                ? "Call in progress"
                : "Call with AI"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Phone</p>
              {!editingPhone ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={startEditPhone}
                  disabled={callBusy || savingPhone}
                  aria-label="Edit phone number"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : null}
            </div>
            {editingPhone ? (
              <div className="mt-2 space-y-2">
                <Input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876543210"
                  value={phoneDraft}
                  onChange={(e) => {
                    setPhoneDraft(e.target.value);
                    setPhoneError(null);
                  }}
                  disabled={savingPhone}
                  aria-invalid={Boolean(phoneError)}
                  aria-describedby={
                    phoneError ? "lead-voice-phone-error" : undefined
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void savePhone()}
                    disabled={savingPhone}
                    aria-busy={savingPhone}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {savingPhone ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelEditPhone}
                    disabled={savingPhone}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
                {phoneError ? (
                  <p
                    id="lead-voice-phone-error"
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {phoneError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Use E.164 format, e.g. +91XXXXXXXXXX
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm font-medium break-all">
                {currentPhone || "Not set"}
              </p>
            )}
          </div>
          <Meta label="Agent" value={agentName} />
          <Meta label="Previous calls" value={String(previousCallCount)} />
          <Meta label="Status" value={statusLabel} />
        </div>

        {live ? (
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{statusLabel}</Badge>
              <Badge variant="outline">
                {live.voiceMode === "realtime"
                  ? live.status === "IN_PROGRESS" ||
                    live.status === "CONNECTED"
                    ? "Realtime AI active"
                    : ACTIVE.has(live.status)
                      ? "Realtime (connecting)"
                      : "Realtime"
                  : "Turn-based AI"}
              </Badge>
              {live.outcome ? <Badge variant="outline">{live.outcome}</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {live.startedAt ? `Started ${formatDate(live.startedAt)}` : null}
              {typeof live.duration === "number"
                ? ` · ${live.duration}s`
                : null}
            </p>

            {live.transcripts && live.transcripts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Live transcript
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                  {live.transcripts.map((t) => (
                    <p key={t.id} className="text-sm">
                      <span className="font-medium">
                        {t.speaker === "agent" ? "Agent" : "Lead"}:
                      </span>{" "}
                      <span className="text-muted-foreground">{t.text}</span>
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            {live.summary ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  AI call summary
                </p>
                <p className="text-sm">{live.summary.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Next: {live.summary.nextAction}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Realtime mode needs the voice-server (WSS) + public VOICE_STREAM_URL.
          If realtime is unavailable, LeadPilot falls back to turn-based Gather/Say
          and labels the call accordingly. Manual click-to-call only.
        </p>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-all">{value}</p>
    </div>
  );
}
