import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { formatDuration, mapLeadToUi } from "@/lib/mappers";

export async function listCalls(user: SessionUser) {
  const calls = await prisma.call.findMany({
    where: { companyId: user.companyId },
    include: {
      lead: true,
      agent: true,
      summary: true,
      transcripts: { orderBy: { timestamp: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return calls.map((call) => ({
    id: call.id,
    leadId: call.leadId,
    agentId: call.agentId ?? "",
    duration: formatDuration(call.duration),
    durationSeconds: call.duration,
    outcome: call.outcome ?? call.summary?.outcome ?? "—",
    qualificationScore: call.qualificationScore ?? 0,
    date: (call.startedAt ?? call.createdAt).toISOString(),
    startedAt: call.startedAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    phoneNumber: call.phoneNumber,
    voiceMode: call.voiceMode,
    transcriptPreview: call.transcripts
      .slice(0, 4)
      .map((t) => `${t.speaker === "AI" ? "Agent" : call.lead.name}: ${t.message}`)
      .join("\n"),
    transcripts: call.transcripts.map((t) => ({
      id: t.id,
      speaker: t.speaker === "AI" ? "agent" : "lead",
      text: t.message,
      timestamp: t.timestamp.toISOString(),
    })),
    aiSummary: call.summary?.summary ?? "No summary available.",
    nextAction: call.summary?.nextAction ?? "Follow up with the lead.",
    summaryDetail: call.summary
      ? {
          summary: call.summary.summary,
          outcome: call.summary.outcome,
          interestLevel: call.summary.interestLevel,
          keyRequirements: call.summary.keyRequirements,
          painPoints: call.summary.painPoints,
          objections: call.summary.objectionList,
          nextAction: call.summary.nextAction,
          followUpRecommended: call.summary.followUpRecommended,
        }
      : null,
    leadName: call.lead.name,
    agentName: call.agent?.name ?? "AI Agent",
    status: call.status,
  }));
}

export async function listFollowUps(user: SessionUser) {
  const followUps = await prisma.followUp.findMany({
    where: { companyId: user.companyId },
    include: { lead: true },
    orderBy: [{ leadId: "asc" }, { sequenceDay: "asc" }],
  });

  const byLead = new Map<string, typeof followUps>();
  for (const item of followUps) {
    const list = byLead.get(item.leadId) ?? [];
    list.push(item);
    byLead.set(item.leadId, list);
  }

  return Array.from(byLead.entries()).map(([leadId, steps]) => {
    const lead = steps[0].lead;
    const hasFailed = steps.some((s) => s.status === "FAILED");
    const allCompleted = steps.every((s) => s.status === "COMPLETED");
    const status = hasFailed
      ? "failed"
      : allCompleted
        ? "completed"
        : steps.some((s) => s.status === "SCHEDULED" || s.status === "SENT")
          ? "scheduled"
          : "pending";

    return {
      id: `seq-${leadId}`,
      leadId,
      name: `${lead.companyName} — Follow-up`,
      status,
      steps: steps.map((s) => ({
        id: s.id,
        day: s.sequenceDay,
        title: s.message,
        status: (() => {
          if (s.status === "COMPLETED") return "completed" as const;
          if (s.status === "FAILED" || s.status === "CANCELLED")
            return "failed" as const;
          if (s.status === "SCHEDULED") return "pending" as const;
          if (s.status === "SENT") return "scheduled" as const;
          return "scheduled" as const;
        })(),
        scheduledFor: s.scheduledAt.toISOString(),
        completedAt:
          s.status === "COMPLETED" ? s.scheduledAt.toISOString() : undefined,
      })),
      leadName: lead.name,
      companyName: lead.companyName,
    };
  });
}

export async function listAppointments(user: SessionUser) {
  const { listCompanyAppointments } = await import("@/services/appointments");
  const appointments = await listCompanyAppointments(user);
  return appointments.map((appt) => ({
    id: appt.id,
    leadId: appt.leadId,
    title: appt.title,
    date: appt.dateTime.slice(0, 10),
    time: new Date(appt.dateTime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: appt.timezone,
    }),
    duration: `${appt.duration} min`,
    location: appt.meetingUrl || appt.calendarLabel,
    notes: appt.notes ?? "",
    ownerId: appt.assignedToId ?? "",
    leadName: appt.leadName,
    companyName: appt.companyName,
    ownerName: appt.ownerName,
    status: appt.status,
    timezone: appt.timezone,
    source: appt.source,
    calendarSynced: appt.calendarSynced,
    calendarLabel: appt.calendarLabel,
    meetingUrl: appt.meetingUrl,
    displayWhen: appt.displayWhen,
    dateTime: appt.dateTime,
  }));
}

export async function listTeam(user: SessionUser) {
  const members = await prisma.user.findMany({
    where: { companyId: user.companyId },
    include: {
      _count: { select: { assignedLeads: true } },
      assignedLeads: { select: { status: true } },
      appointments: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" "),
    status: "online" as const,
    avatarInitials: member.name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    leadsCount: member._count.assignedLeads,
    meetingsCount: member.appointments.length,
    dealsWon: member.assignedLeads.filter((l) => l.status === "WON").length,
  }));
}

export async function listNotifications(user: SessionUser) {
  return prisma.notification.findMany({
    where: { companyId: user.companyId, userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

export async function unreadNotificationCount(user: SessionUser) {
  return prisma.notification.count({
    where: { companyId: user.companyId, userId: user.id, read: false },
  });
}

export async function markNotificationRead(
  user: SessionUser,
  id: string,
  read: boolean
) {
  const existing = await prisma.notification.findFirst({
    where: { id, companyId: user.companyId, userId: user.id },
  });
  if (!existing) return null;

  return prisma.notification.update({
    where: { id },
    data: { read },
  });
}

export async function getAiAgent(user: SessionUser) {
  return prisma.aIAgent.findFirst({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "asc" },
  });
}

export async function listPipelineLeads(user: SessionUser) {
  const leads = await prisma.lead.findMany({
    where: { companyId: user.companyId },
    include: { analysis: true, assignedTo: true },
    orderBy: { updatedAt: "desc" },
  });
  return leads.map(mapLeadToUi);
}
