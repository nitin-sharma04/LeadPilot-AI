import type { ComponentType } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Mail, Phone } from "lucide-react";
import { ScoreBadge, StatusBadge } from "@/components/leads/badges";
import { LeadAiAnalysisPanel } from "@/components/leads/lead-ai-analysis-panel";
import { LeadAiResponsePanel } from "@/components/leads/lead-ai-response-panel";
import { LeadAiEmailPanel } from "@/components/leads/lead-ai-email-panel";
import { LeadAiVoicePanel } from "@/components/leads/lead-ai-voice-panel";
import { LeadAppointmentsPanel } from "@/components/leads/lead-appointments-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { mapLeadToUi, formatDuration as fmtDuration } from "@/lib/mappers";
import { requireSession } from "@/lib/session";
import { getLeadById } from "@/services/leads";
import { prisma } from "@/lib/prisma";
import {
  fromPrismaChannel,
  fromPrismaResponseType,
  fromPrismaTone,
} from "@/types/sales-response";

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: LeadDetailPageProps) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const lead = await getLeadById(user, id);
    return { title: lead.name };
  } catch {
    return { title: "Lead" };
  }
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const user = await requireSession();
  const { id } = await params;

  let lead;
  try {
    lead = await getLeadById(user, id);
  } catch {
    notFound();
  }

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { timezone: true },
  });
  const timezone = company?.timezone || "UTC";

  const ui = mapLeadToUi(lead);
  const owner = lead.assignedTo;
  const analysis = lead.analysis
    ? {
        score: lead.analysis.score,
        intent: lead.analysis.intent,
        urgency: lead.analysis.urgency,
        estimatedBudget: lead.analysis.estimatedBudget,
        industry: lead.analysis.industry,
        buyingStage: lead.analysis.buyingStage,
        requirements: lead.analysis.requirements,
        painPoints: lead.analysis.painPoints,
        objections: lead.analysis.objections,
        recommendation: lead.analysis.recommendation,
        reasoning: lead.analysis.reasoning,
        source: lead.analysis.source,
        updatedAt: lead.analysis.updatedAt.toISOString(),
      }
    : null;

  const generatedResponses = lead.generatedResponses
    .map((row) => {
      const channel = fromPrismaChannel(row.channel);
      const responseType = fromPrismaResponseType(row.responseType);
      const tone = fromPrismaTone(row.tone);
      if (!channel || !responseType || !tone) return null;
      return {
        id: row.id,
        leadId: row.leadId,
        channel,
        responseType,
        tone,
        subject: row.subject,
        body: row.body,
        callToAction: row.callToAction,
        personalizationNotes: row.personalizationNotes,
        provider: row.provider,
        model: row.model,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const lastCall = lead.calls[0]
    ? {
        id: lead.calls[0].id,
        status: lead.calls[0].status,
        phoneNumber: lead.calls[0].phoneNumber,
        startedAt: lead.calls[0].startedAt?.toISOString() ?? null,
        endedAt: lead.calls[0].endedAt?.toISOString() ?? null,
        duration: lead.calls[0].duration,
        outcome: lead.calls[0].outcome,
        voiceMode: lead.calls[0].voiceMode,
      }
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild>
            <Link href="/dashboard/leads">
              <ArrowLeft className="h-4 w-4" />
              Back to leads
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
            <StatusBadge status={ui.status} />
            {lead.emailOptOut ? (
              <Badge variant="danger">Email Opt-Out</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {lead.companyName} · Created {formatDate(lead.createdAt.toISOString())}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled title="Available in a later phase">
            Contact
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Lead profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow icon={Building2} label="Company" value={lead.companyName} />
              <InfoRow icon={Mail} label="Email" value={lead.email} />
              <InfoRow icon={Phone} label="Phone" value={lead.phone ?? "—"} />
              <InfoRow label="Industry" value={lead.industry ?? "—"} />
              <InfoRow label="Source" value={ui.source} />
              <InfoRow label="Owner" value={owner?.name ?? "Unassigned"} />
              <InfoRow label="Deal value" value={formatCurrency(lead.dealValue)} />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Score
                </p>
                <div className="mt-1">
                  <ScoreBadge score={lead.score} />
                </div>
              </div>
            </div>

            {lead.externalIdentities.length > 0 ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  External CRM
                </p>
                <div className="mt-2 space-y-2">
                  {lead.externalIdentities.map((ext) => (
                    <div
                      key={ext.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        {ext.provider} · ID {ext.externalId}
                      </span>
                      <Badge
                        variant={
                          ext.syncStatus === "FAILED"
                            ? "danger"
                            : ext.syncStatus === "PENDING"
                              ? "secondary"
                              : "info"
                        }
                      >
                        {ext.syncStatus}
                      </Badge>
                    </div>
                  ))}
                </div>
                {lead.externalIdentities.some((e) => e.lastSyncError) ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {
                      lead.externalIdentities.find((e) => e.lastSyncError)
                        ?.lastSyncError
                    }
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lead message
              </p>
              <blockquote className="mt-2 rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
                “{lead.message || "No message provided."}”
              </blockquote>
            </div>
          </CardContent>
        </Card>

        <LeadAiAnalysisPanel
          leadId={lead.id}
          initialAnalysis={analysis}
          fallbackScore={lead.score}
          fallbackIntent={lead.intent}
          fallbackUrgency={lead.urgency}
          fallbackBudget={lead.budget}
        />
      </div>

      <LeadAiResponsePanel
        leadId={lead.id}
        hasAnalysis={Boolean(lead.analysis)}
        initialResponses={generatedResponses}
      />

      <LeadAiEmailPanel
        leadId={lead.id}
        leadEmail={lead.email}
        emailOptOut={lead.emailOptOut}
      />

      <LeadAiVoicePanel
        leadId={lead.id}
        phone={lead.phone}
        agentName="Alex (AI)"
        previousCallCount={lead.calls.length}
        lastCall={lastCall}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              lead.activities.map((activity) => (
                <div
                  key={activity.id}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  <p className="text-sm">{activity.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(activity.createdAt.toISOString())}
                    {activity.user ? ` · ${activity.user.name}` : ""}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.calls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calls yet.</p>
            ) : (
              lead.calls.map((call) => (
                <div
                  key={call.id}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  <p className="text-sm font-medium">
                    {call.outcome ?? call.status} · {fmtDuration(call.duration)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Score {call.qualificationScore ?? "—"}/100
                    {call.summary?.nextAction
                      ? ` · ${call.summary.nextAction}`
                      : ""}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.followUps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No follow-ups yet.</p>
            ) : (
              lead.followUps.map((fu) => (
                <div
                  key={fu.id}
                  className="rounded-lg border border-border px-3 py-2.5"
                >
                  <p className="text-sm font-medium">
                    Day {fu.sequenceDay} — {fu.message}
                  </p>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {fu.status.toLowerCase()}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appointments</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadAppointmentsPanel
              leadId={lead.id}
              leadName={lead.name}
              timezone={timezone}
              appointments={lead.appointments.map((appt) => ({
                id: appt.id,
                title: appt.title,
                dateTime: appt.dateTime.toISOString(),
                duration: appt.duration,
                timezone: appt.timezone,
                status: appt.status,
                meetingUrl: appt.meetingUrl,
                calendarProvider: appt.calendarProvider,
                externalEventId: appt.externalEventId,
                assignedTo: appt.assignedTo
                  ? { name: appt.assignedTo.name }
                  : null,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2 text-sm font-medium">
        {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        <span className="break-all">{value}</span>
      </div>
    </div>
  );
}
