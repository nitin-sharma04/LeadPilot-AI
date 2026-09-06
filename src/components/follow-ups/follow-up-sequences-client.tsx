"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

type Enrollment = {
  id: string;
  status: string;
  currentStepOrder: number;
  nextRunAt: string | null;
  stopReason: string | null;
  lead: { id: string; name: string; email: string };
  sequence: { id: string; name: string };
};

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  steps: Array<{
    stepOrder: number;
    delayDays: number;
    emailType: string;
    tone: string;
    enabled: boolean;
  }>;
  _count: { enrollments: number };
};

export function FollowUpSequencesClient() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/follow-up-sequences");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed");
    setSequences(json.data.sequences || []);
    setEnrollments(json.data.enrollments || []);
  }

  useEffect(() => {
    void load().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Unable to load")
    );
  }, []);

  async function act(id: string, action: "pause" | "resume" | "stop") {
    setBusy(id);
    try {
      const res = await fetch(`/api/follow-up-sequences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success(`Sequence ${action}d`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to update");
    } finally {
      setBusy(null);
    }
  }

  const counts = {
    active: enrollments.filter((e) => e.status === "ACTIVE").length,
    paused: enrollments.filter((e) => e.status === "PAUSED").length,
    completed: enrollments.filter((e) => e.status === "COMPLETED").length,
    stopped: enrollments.filter((e) => e.status === "STOPPED").length,
    failed: enrollments.filter((e) => e.status === "FAILED").length,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Active", counts.active],
            ["Paused", counts.paused],
            ["Completed", counts.completed],
            ["Stopped", counts.stopped],
            ["Failed", counts.failed],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {sequences.map((seq) => (
          <Card key={seq.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {seq.name}
                {seq.isDefault ? <Badge variant="secondary">Default</Badge> : null}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {seq.description || "Email nurture sequence"} ·{" "}
                {seq._count.enrollments} enrollments
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {seq.steps.map((step) => (
                <div
                  key={step.stepOrder}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    Step {step.stepOrder}: {step.emailType} · {step.tone}
                  </span>
                  <span className="text-muted-foreground">
                    +{step.delayDays}d
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enrollments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No enrollments yet. Enroll a lead from Lead Detail or enable
              post-call automation.
            </p>
          ) : (
            enrollments.map((en) => (
              <div
                key={en.id}
                className="flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {en.lead.name}{" "}
                    <span className="text-muted-foreground">
                      · {en.sequence.name}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Step {en.currentStepOrder}
                    {en.nextRunAt
                      ? ` · next ${formatDate(en.nextRunAt)}`
                      : ""}
                    {en.stopReason ? ` · ${en.stopReason}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{en.status}</Badge>
                  {en.status === "ACTIVE" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === en.id}
                        onClick={() => void act(en.id, "pause")}
                      >
                        Pause
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === en.id}
                        onClick={() => void act(en.id, "stop")}
                      >
                        Stop
                      </Button>
                    </>
                  ) : null}
                  {en.status === "PAUSED" ? (
                    <Button
                      size="sm"
                      disabled={busy === en.id}
                      onClick={() => void act(en.id, "resume")}
                    >
                      Resume
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
