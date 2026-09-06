"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Appt = {
  id: string;
  title: string;
  dateTime: string;
  duration: number;
  timezone: string;
  status: string;
  meetingUrl?: string | null;
  calendarProvider?: string | null;
  externalEventId?: string | null;
  assignedTo?: { name: string } | null;
};

export function LeadAppointmentsPanel({
  leadId,
  leadName,
  appointments,
  timezone,
}: {
  leadId: string;
  leadName: string;
  appointments: Appt[];
  timezone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [title, setTitle] = useState(`Discovery call — ${leadName}`);

  const upcoming = appointments.filter(
    (a) => a.status === "SCHEDULED" && new Date(a.dateTime).getTime() >= Date.now()
  );

  async function schedule() {
    if (!startLocal) {
      toast.error("Pick a start time");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          title,
          startTime: new Date(startLocal).toISOString(),
          durationMinutes: 30,
          timezone,
          source: "MANUAL",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success(
        json.data?.calendarSynced
          ? "Booked + Google Calendar synced"
          : "LeadPilot appointment created"
      );
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to schedule");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success("Cancelled");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Timezone: {timezone}</p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Schedule"}
        </Button>
      </div>

      {open ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Start</Label>
            <Input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void schedule()}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </div>
      ) : null}

      {appointments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No appointments yet.</p>
      ) : (
        appointments.map((appt) => {
          const isUpcoming = upcoming.some((u) => u.id === appt.id);
          return (
            <div
              key={appt.id}
              className="rounded-lg border border-border px-3 py-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {isUpcoming ? "Upcoming Meeting · " : ""}
                    {appt.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(appt.dateTime).toLocaleString("en-US", {
                      timeZone: appt.timezone,
                    })}{" "}
                    · {appt.duration} min · {appt.timezone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Assigned: {appt.assignedTo?.name || "Unassigned"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline">{appt.status}</Badge>
                  <Badge variant="secondary">
                    {appt.externalEventId
                      ? "Google Calendar"
                      : "LeadPilot appointment"}
                  </Badge>
                </div>
              </div>
              {appt.status === "SCHEDULED" ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void cancel(appt.id)}
                  >
                    Cancel
                  </Button>
                  {appt.meetingUrl ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={appt.meetingUrl} target="_blank" rel="noreferrer">
                        Open meeting
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
