import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { AppointmentsClient } from "@/components/appointments/appointments-client";
import { requireSession } from "@/lib/session";
import { listAppointments } from "@/services/workspace";
import { prisma } from "@/lib/prisma";
import { getGoogleConnectionStatus } from "@/services/appointments";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Appointments",
};

export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const user = await requireSession();
  const [appointments, leads, company, google] = await Promise.all([
    listAppointments(user),
    prisma.lead.findMany({
      where: { companyId: user.companyId },
      select: { id: true, name: true, companyName: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: { timezone: true },
    }),
    getGoogleConnectionStatus(user),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="Schedule meetings with timezone awareness and optional Google Calendar sync."
        actions={
          <Badge variant="secondary">
            {google.connected
              ? `Google Calendar · ${google.googleEmail}`
              : "LeadPilot appointments (Google optional)"}
          </Badge>
        }
      />

      {appointments.length === 0 && leads.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No appointments"
          description="Add a lead first, then schedule a meeting."
        />
      ) : (
        <AppointmentsClient
          appointments={appointments}
          leads={leads}
          defaultTimezone={company?.timezone || "UTC"}
        />
      )}
    </div>
  );
}
