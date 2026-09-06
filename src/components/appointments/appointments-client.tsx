"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AppointmentListItem = {
  id: string;
  leadId: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  location: string;
  notes: string;
  ownerId: string;
  leadName: string;
  companyName: string;
  ownerName: string;
  status: string;
  timezone: string;
  source: string;
  calendarSynced: boolean;
  calendarLabel: string;
  meetingUrl: string | null;
  displayWhen: string;
  dateTime: string;
};

type LeadOption = { id: string; name: string; companyName: string };

export function AppointmentsClient({
  appointments,
  leads,
  defaultTimezone,
}: {
  appointments: AppointmentListItem[];
  leads: LeadOption[];
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"upcoming" | "past" | "cancelled">(
    "upcoming"
  );
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    leadId: leads[0]?.id || "",
    title: "Discovery call",
    startLocal: "",
    durationMinutes: 30,
    timezone: defaultTimezone,
    notes: "",
  });

  const now = Date.now();
  const filtered = useMemo(() => {
    return appointments.filter((a) => {
      if (filter === "cancelled") return a.status === "CANCELLED";
      const ts = new Date(a.dateTime).getTime();
      if (filter === "past") return a.status !== "CANCELLED" && ts < now;
      return a.status === "SCHEDULED" && ts >= now;
    });
  }, [appointments, filter, now]);

  async function createAppointment() {
    if (!form.leadId || !form.startLocal) {
      toast.error("Lead and start time are required");
      return;
    }
    setCreating(true);
    try {
      const startTime = new Date(form.startLocal).toISOString();
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: form.leadId,
          title: form.title,
          startTime,
          durationMinutes: form.durationMinutes,
          timezone: form.timezone,
          notes: form.notes || undefined,
          source: "MANUAL",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create");
      toast.success(
        json.data?.calendarSynced
          ? "Appointment booked and synced to Google Calendar"
          : "LeadPilot appointment created"
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to create");
    } finally {
      setCreating(false);
    }
  }

  async function cancelAppt(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success("Appointment cancelled");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to cancel");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["upcoming", "past", "cancelled"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {key}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create appointment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lead">Lead</Label>
            <select
              id="lead"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.leadId}
              onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}
            >
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="start">Start</Label>
            <Input
              id="start"
              type="datetime-local"
              value={form.startLocal}
              onChange={(e) =>
                setForm((f) => ({ ...f, startLocal: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tz">Timezone (IANA)</Label>
            <Input
              id="tz"
              value={form.timezone}
              onChange={(e) =>
                setForm((f) => ({ ...f, timezone: e.target.value }))
              }
              placeholder="Asia/Kolkata"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dur">Duration (minutes)</Label>
            <Input
              id="dur"
              type="number"
              min={15}
              max={480}
              value={form.durationMinutes}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  durationMinutes: Number(e.target.value) || 30,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => void createAppointment()} disabled={creating}>
              {creating ? "Booking…" : "Book appointment"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              {filter === "upcoming"
                ? "Upcoming"
                : filter === "past"
                  ? "Past"
                  : "Cancelled"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No appointments.</p>
            ) : (
              filtered.map((appt) => (
                <div
                  key={appt.id}
                  className="rounded-lg border border-border px-3.5 py-3"
                >
                  <p className="text-sm font-semibold">{appt.leadName}</p>
                  <p className="text-xs text-muted-foreground">
                    {appt.companyName}
                  </p>
                  <p className="mt-2 text-sm">{appt.title}</p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    {appt.displayWhen}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          {filtered.map((appt) => (
            <Card key={appt.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{appt.title}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {appt.leadName} · {appt.companyName}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="info">{appt.status}</Badge>
                    <Badge variant="outline">{appt.calendarLabel}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Meta label="When" value={appt.displayWhen} />
                  <Meta label="Timezone" value={appt.timezone} />
                  <Meta label="Duration" value={appt.duration} />
                  <Meta label="Owner" value={appt.ownerName} />
                  <Meta label="Source" value={appt.source} />
                  <Meta
                    label="Calendar"
                    value={
                      appt.calendarSynced ? "Google Calendar" : "LeadPilot only"
                    }
                  />
                </div>
                {appt.notes ? (
                  <p className="text-sm text-muted-foreground">{appt.notes}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/leads/${appt.leadId}`}>
                      View lead
                    </Link>
                  </Button>
                  {appt.meetingUrl ? (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={appt.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open meeting
                      </a>
                    </Button>
                  ) : null}
                  {appt.status === "SCHEDULED" ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === appt.id}
                      onClick={() => void cancelAppt(appt.id)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
