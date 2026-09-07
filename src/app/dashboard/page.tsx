import { CalendarDays, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { PerformanceChart } from "@/components/dashboard/performance-chart";
import { AiInsights } from "@/components/dashboard/ai-insights";
import { RecentLeads } from "@/components/dashboard/recent-leads";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/session";
import { getDashboardMetrics } from "@/services/analytics";
import { mapLeadToUi } from "@/lib/mappers";
import { listTeam } from "@/services/workspace";

export const metadata: Metadata = {
  title: "Overview",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireSession();
  let metrics: Awaited<ReturnType<typeof getDashboardMetrics>>;
  let team: Awaited<ReturnType<typeof listTeam>> = [];
  try {
    [metrics, team] = await Promise.all([
      getDashboardMetrics(user),
      listTeam(user),
    ]);
  } catch (error) {
    console.error("[dashboard] failed to load metrics", error);
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <h1 className="text-lg font-semibold">Dashboard temporarily unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We could not load your pipeline data from the database. Refresh in a
          moment. If this keeps happening, check Render{" "}
          <code className="text-xs">DATABASE_URL</code> (use the Supabase pooler
          with <code className="text-xs">connection_limit=5</code>).
        </p>
      </div>
    );
  }

  const recent = metrics.recentLeads.map(mapLeadToUi);
  const ownerNames = Object.fromEntries(team.map((m) => [m.id, m.name]));
  const firstName = user.name.split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
            Good morning, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-[0.9375rem]">
            Here&apos;s what&apos;s happening with your sales pipeline today.
          </p>
        </div>
        <Button variant="outline" className="w-fit gap-2" type="button">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          Last 30 days
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>

      <KpiCards
        totalLeads={metrics.totalLeads}
        hotLeads={metrics.hotLeads}
        conversionRate={metrics.conversionRate}
        pipelineValue={metrics.pipelineValue}
        trends={metrics.trends}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["Emails sent", metrics.email.emailsSent],
            ["Replies", metrics.email.replies],
            ["Active sequences", metrics.email.activeSequences],
            ["Upcoming follow-ups", metrics.email.upcomingFollowUps],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border bg-card px-5 py-4 shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ["New leads today", metrics.capture.leadsToday],
            ["Leads this week", metrics.capture.leadsThisWeek],
            ["Web / form leads", metrics.capture.webLeads],
            ["API leads", metrics.capture.apiLeads],
            ["CRM leads", metrics.capture.crmLeads],
            ["Imported (CSV)", metrics.capture.importedLeads],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border bg-card px-5 py-4 shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {metrics.capture.bySource.length > 0 ? (
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground">
            Lead source distribution
          </h2>
          <div className="mt-4 space-y-2">
            {metrics.capture.bySource
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((row) => {
                const max = Math.max(
                  ...metrics.capture.bySource.map((r) => r.count),
                  1
                );
                const pct = Math.round((row.count / max) * 100);
                const label = row.source
                  .split("_")
                  .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
                  .join(" ");
                return (
                  <div key={row.source} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <PerformanceChart />
        </div>
        <div className="xl:col-span-2">
          <AiInsights />
        </div>
      </div>

      <RecentLeads leads={recent} ownerNames={ownerNames} />
    </div>
  );
}
