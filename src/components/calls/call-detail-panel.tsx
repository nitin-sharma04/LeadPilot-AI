"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { CALL_STATUS_LABELS } from "@/types/voice";

export type CallDetailView = {
  id: string;
  status: string;
  phoneNumber: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  duration: number | null;
  outcome: string | null;
  voiceMode?: string | null;
  provider?: string | null;
  aiProvider?: string | null;
  leadName: string;
  agentName: string;
  transcripts: Array<{
    id: string;
    speaker: "agent" | "lead" | string;
    text: string;
    timestamp: string;
  }>;
  summary: {
    summary: string;
    outcome: string | null;
    interestLevel: string | null;
    keyRequirements: string[];
    painPoints: string[];
    objections: string[];
    nextAction: string | null;
    followUpRecommended?: boolean;
  } | null;
};

export function CallDetailPanel({ call }: { call: CallDetailView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Call detail</CardTitle>
        <p className="text-sm text-muted-foreground">
          {call.leadName} · {call.agentName}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Info
            label="Status"
            value={CALL_STATUS_LABELS[call.status] ?? call.status}
          />
          <Info
            label="Call mode"
            value={
              call.voiceMode === "realtime"
                ? "Realtime (Gemini Live)"
                : "Turn-based fallback"
            }
          />
          <Info label="Provider" value={call.provider ?? "Twilio"} />
          <Info label="AI provider" value={call.aiProvider ?? "Gemini"} />
          <Info label="Phone" value={call.phoneNumber ?? "—"} />
          <Info
            label="Started"
            value={call.startedAt ? formatDate(call.startedAt) : "—"}
          />
          <Info
            label="Ended"
            value={call.endedAt ? formatDate(call.endedAt) : "—"}
          />
          <Info
            label="Duration"
            value={
              typeof call.duration === "number" ? `${call.duration}s` : "—"
            }
          />
          <Info label="Outcome" value={call.outcome ?? "—"} />
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Transcript</h3>
          {call.transcripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcript yet.</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
              {call.transcripts.map((t) => (
                <p key={t.id} className="text-sm leading-relaxed">
                  <span className="font-medium">
                    {t.speaker === "agent" || t.speaker === "AI"
                      ? "Agent"
                      : "Lead"}
                    :
                  </span>{" "}
                  <span className="text-muted-foreground">{t.text}</span>
                </p>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">AI Call Summary</h3>
          {call.summary ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm">{call.summary.summary}</p>
              <div className="flex flex-wrap gap-2">
                {call.summary.outcome ? (
                  <Badge variant="outline">{call.summary.outcome}</Badge>
                ) : null}
                {call.summary.interestLevel ? (
                  <Badge variant="secondary">
                    Interest: {call.summary.interestLevel}
                  </Badge>
                ) : null}
              </div>
              <List label="Key requirements" items={call.summary.keyRequirements} />
              <List label="Pain points" items={call.summary.painPoints} />
              <List label="Objections" items={call.summary.objections} />
              <p className="text-sm">
                <span className="font-medium">Next action:</span>{" "}
                {call.summary.nextAction}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Summary appears after the call completes.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-all">{value}</p>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
