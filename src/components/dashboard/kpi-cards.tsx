import {
  ArrowDownRight,
  ArrowUpRight,
  Flame,
  Percent,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type KpiCardsProps = {
  totalLeads: number;
  hotLeads: number;
  conversionRate: number;
  pipelineValue: number;
  trends: {
    totalLeads: number;
    hotLeads: number;
    conversionRate: number;
    pipelineValue: number;
  };
};

const icons = {
  leads: Users,
  hot: Flame,
  conversion: Percent,
  pipeline: Wallet,
} as const;

export function KpiCards({
  totalLeads,
  hotLeads,
  conversionRate,
  pipelineValue,
  trends,
}: KpiCardsProps) {
  const cards = [
    {
      id: "total",
      title: "Total Leads",
      value: formatNumber(totalLeads),
      trend: trends.totalLeads,
      context: "Across all channels this period",
      icon: "leads" as const,
    },
    {
      id: "hot",
      title: "Hot Leads",
      value: formatNumber(hotLeads),
      trend: trends.hotLeads,
      context: "Score 90+ in your pipeline",
      icon: "hot" as const,
    },
    {
      id: "conversion",
      title: "Conversion Rate",
      value: formatPercent(conversionRate),
      trend: trends.conversionRate,
      context: "Won deals vs total leads",
      icon: "conversion" as const,
    },
    {
      id: "pipeline",
      title: "Pipeline Value",
      value: formatCurrency(pipelineValue),
      trend: trends.pipelineValue,
      context: "Open opportunities only",
      icon: "pipeline" as const,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = icons[card.icon];
        const positive = card.trend >= 0;
        return (
          <Card
            key={card.id}
            className="group hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_rgba(15,23,42,0.06)]"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </p>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 text-primary transition-colors group-hover:bg-primary/12">
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
              </div>
              <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
                {card.value}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-medium",
                    positive ? "text-emerald-600" : "text-rose-600"
                  )}
                >
                  {positive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {positive ? "+" : ""}
                  {card.trend}%
                </span>
                <span className="text-xs text-muted-foreground">vs prior 30 days</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{card.context}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
