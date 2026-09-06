import { AlertTriangle, Lightbulb, TrendingUp, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiInsights } from "@/data/demo";
import { cn } from "@/lib/utils";

const iconMap = {
  alert: AlertTriangle,
  opportunity: Zap,
  tip: Lightbulb,
  trend: TrendingUp,
} as const;

const toneMap = {
  alert: "bg-amber-50 text-amber-700",
  opportunity: "bg-teal-50 text-teal-700",
  tip: "bg-sky-50 text-sky-700",
  trend: "bg-violet-50 text-violet-700",
} as const;

export function AiInsights() {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>AI Sales Insights</CardTitle>
        <p className="text-sm text-muted-foreground">
          Demo insights derived from sample data — not live AI output
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {aiInsights.map((insight) => {
          const Icon = iconMap[insight.type];
          return (
            <div
              key={insight.id}
              className="rounded-lg border border-border/80 bg-muted/30 p-3.5 transition-colors hover:bg-muted/50"
            >
              <div className="flex gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    toneMap[insight.type]
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{insight.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {insight.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
