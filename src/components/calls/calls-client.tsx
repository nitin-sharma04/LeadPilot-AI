"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CallDetailPanel } from "@/components/calls/call-detail-panel";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CALL_STATUS_LABELS } from "@/types/voice";

export type CallListItem = {
  id: string;
  leadId: string;
  agentId: string;
  duration: string;
  outcome: string;
  qualificationScore: number;
  date: string;
  transcriptPreview: string;
  aiSummary: string;
  nextAction: string;
  leadName: string;
  agentName: string;
  status: string;
  phoneNumber?: string | null;
  voiceMode?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  transcripts?: Array<{
    id: string;
    speaker: string;
    text: string;
    timestamp: string;
  }>;
  summaryDetail?: {
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

export function CallsClient({ calls }: { calls: CallListItem[] }) {
  const [selectedId, setSelectedId] = useState(calls[0]?.id ?? "");
  const selected = calls.find((c) => c.id === selectedId) ?? calls[0];

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Lead</th>
                  <th className="px-3 py-3 font-medium">Phone</th>
                  <th className="px-3 py-3 font-medium">Mode</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Duration</th>
                  <th className="px-3 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const active = call.id === selected?.id;
                  return (
                    <tr
                      key={call.id}
                      className={cn(
                        "cursor-pointer border-b border-border/70 last:border-0",
                        active ? "bg-primary/5" : "hover:bg-muted/30"
                      )}
                      onClick={() => setSelectedId(call.id)}
                    >
                      <td className="px-5 py-3.5 font-medium">{call.leadName}</td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {call.phoneNumber ?? "—"}
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge variant="secondary">
                          {call.voiceMode === "realtime"
                            ? "Realtime"
                            : "Turn-based fallback"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge variant="outline">
                          {CALL_STATUS_LABELS[call.status] ?? call.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 tabular-nums">{call.duration}</td>
                      <td className="px-3 py-3.5">
                        <Badge variant="secondary">{call.outcome}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {formatDate(call.date)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <div className="xl:col-span-2">
          <CallDetailPanel
            call={{
              id: selected.id,
              status: selected.status,
              phoneNumber: selected.phoneNumber ?? null,
              startedAt: selected.startedAt ?? selected.date,
              answeredAt: null,
              endedAt: selected.endedAt ?? null,
              duration: selected.durationSeconds ?? null,
              outcome: selected.outcome,
              voiceMode: selected.voiceMode ?? "turn_based",
              provider: "twilio",
              aiProvider: "gemini",
              leadName: selected.leadName,
              agentName: selected.agentName,
              transcripts:
                selected.transcripts?.map((t) => ({
                  id: t.id,
                  speaker: t.speaker,
                  text: t.text,
                  timestamp: t.timestamp,
                })) ?? [],
              summary: selected.summaryDetail ?? {
                summary: selected.aiSummary,
                outcome: selected.outcome,
                interestLevel: null,
                keyRequirements: [],
                painPoints: [],
                objections: [],
                nextAction: selected.nextAction,
              },
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
