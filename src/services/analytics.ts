import { LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";

export async function getDashboardMetrics(user: SessionUser) {
  const companyId = user.companyId;

  // Run in small batches so a low Prisma pool (or cold pooler) cannot P2024.
  const [totalLeads, hotLeads, wonDeals] = await Promise.all([
    prisma.lead.count({ where: { companyId } }),
    prisma.lead.count({ where: { companyId, score: { gte: 90 } } }),
    prisma.lead.findMany({
      where: { companyId, status: LeadStatus.WON },
      select: { dealValue: true },
    }),
  ]);

  const [qualifiedLeads, meetings, pipelineAgg] = await Promise.all([
    prisma.lead.count({
      where: {
        companyId,
        status: {
          in: [
            LeadStatus.QUALIFIED,
            LeadStatus.MEETING,
            LeadStatus.PROPOSAL,
            LeadStatus.WON,
          ],
        },
      },
    }),
    prisma.lead.count({ where: { companyId, status: LeadStatus.MEETING } }),
    prisma.lead.aggregate({
      where: {
        companyId,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
      },
      _sum: { dealValue: true },
    }),
  ]);

  const [revenueAgg, recentLeads, scoreAgg, analyzedCount] = await Promise.all([
    prisma.lead.aggregate({
      where: { companyId, status: LeadStatus.WON },
      _sum: { dealValue: true },
    }),
    prisma.lead.findMany({
      where: { companyId },
      include: { analysis: true, assignedTo: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.lead.aggregate({
      where: { companyId },
      _avg: { score: true },
    }),
    prisma.leadAnalysis.count({
      where: { lead: { companyId } },
    }),
  ]);

  const wonCount = wonDeals.length;
  const revenue = revenueAgg._sum.dealValue ?? 0;
  const pipelineValue = pipelineAgg._sum.dealValue ?? 0;
  const conversionRate = totalLeads === 0 ? 0 : (wonCount / totalLeads) * 100;
  const avgDealSize = wonCount === 0 ? 0 : revenue / wonCount;
  const averageLeadScore = Math.round(scoreAgg._avg.score ?? 0);

  const { getCompanyEmailMetrics } = await import("@/services/email");
  const emailMetrics = await getCompanyEmailMetrics(companyId).catch(() => ({
    emailsSent: 0,
    emailsFailed: 0,
    replies: 0,
    activeSequences: 0,
    completedSequences: 0,
    stoppedSequences: 0,
    upcomingFollowUps: 0,
    replyRate: 0,
  }));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));

  const [leadsToday, leadsThisWeek, bySource] = await Promise.all([
    prisma.lead.count({
      where: { companyId, createdAt: { gte: startOfToday } },
    }),
    prisma.lead.count({
      where: { companyId, createdAt: { gte: startOfWeek } },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { companyId },
      _count: { _all: true },
    }),
  ]);

  const sourceCounts = Object.fromEntries(
    bySource.map((r) => [r.source, r._count._all])
  ) as Record<string, number>;

  const captureMetrics = {
    leadsToday,
    leadsThisWeek,
    webLeads:
      (sourceCounts.WEBSITE || 0) +
      (sourceCounts.WEB_FORM || 0),
    apiLeads: sourceCounts.API || 0,
    crmLeads:
      (sourceCounts.HUBSPOT || 0) + (sourceCounts.SALESFORCE || 0),
    importedLeads: sourceCounts.CSV || 0,
    bySource: bySource.map((row) => ({
      source: row.source,
      count: row._count._all,
    })),
  };

  return {
    totalLeads,
    hotLeads,
    wonCount,
    qualifiedCount: qualifiedLeads,
    meetings,
    pipelineValue,
    revenue,
    conversionRate,
    avgDealSize,
    averageLeadScore,
    analyzedCount,
    unanalyzedCount: Math.max(0, totalLeads - analyzedCount),
    email: emailMetrics,
    capture: captureMetrics,
    // Display trends are illustrative period-over-period placeholders
    trends: {
      totalLeads: 18.2,
      hotLeads: 12.4,
      conversionRate: 2.8,
      pipelineValue: 24.6,
    },
    recentLeads,
  };
}

export async function getAnalytics(user: SessionUser) {
  const companyId = user.companyId;
  const metrics = await getDashboardMetrics(user);

  const [byStatus, scoreBuckets, callsCount] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { companyId },
      select: { score: true },
    }),
    prisma.call.count({ where: { companyId } }),
  ]);

  const bySource = metrics.capture.bySource.map((row) => ({
    source: row.source as import("@prisma/client").LeadSource,
    _count: { _all: row.count },
  }));

  const scoreDistribution = [
    { name: "90–100", value: scoreBuckets.filter((l) => l.score >= 90).length },
    {
      name: "70–89",
      value: scoreBuckets.filter((l) => l.score >= 70 && l.score <= 89).length,
    },
    {
      name: "50–69",
      value: scoreBuckets.filter((l) => l.score >= 50 && l.score <= 69).length,
    },
    { name: "0–49", value: scoreBuckets.filter((l) => l.score < 50).length },
  ];

  const funnelOrder: LeadStatus[] = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.QUALIFIED,
    LeadStatus.MEETING,
    LeadStatus.PROPOSAL,
    LeadStatus.WON,
  ];

  const statusMap = Object.fromEntries(
    byStatus.map((row) => [row.status, row._count._all])
  ) as Record<LeadStatus, number>;

  // Cumulative-style funnel for UI continuity
  const funnel = funnelOrder.map((status, index) => {
    const remaining = funnelOrder.slice(index);
    const value = remaining.reduce((sum, s) => sum + (statusMap[s] ?? 0), 0);
    return {
      name: status.charAt(0) + status.slice(1).toLowerCase(),
      value,
    };
  });

  const sourceDistribution = bySource.map((row) => ({
    name: row.source
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" "),
    value: row._count._all,
  }));

  const wonByMonth = await prisma.lead.findMany({
    where: { companyId, status: LeadStatus.WON },
    select: { dealValue: true, updatedAt: true },
  });

  const revenueTrendMap = new Map<string, number>();
  for (const deal of wonByMonth) {
    const key = deal.updatedAt.toLocaleString("en-US", { month: "short" });
    revenueTrendMap.set(key, (revenueTrendMap.get(key) ?? 0) + deal.dealValue);
  }

  const revenueTrend = Array.from(revenueTrendMap.entries()).map(
    ([month, revenue]) => ({ month, revenue })
  );

  return {
    ...metrics,
    callsCount,
    sourceDistribution,
    statusDistribution: byStatus.map((row) => ({
      name: row.status,
      value: row._count._all,
    })),
    scoreDistribution,
    funnel,
    revenueTrend:
      revenueTrend.length > 0
        ? revenueTrend
        : [{ month: "Sep", revenue: metrics.revenue }],
  };
}
