import { Badge } from "@/components/ui/badge";
import { getScoreLabel, getScoreTier } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/types";

const statusConfig: Record<
  LeadStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" | "danger" | "info" }
> = {
  new: { label: "New", variant: "info" },
  hot: { label: "Hot", variant: "danger" },
  qualified: { label: "Qualified", variant: "success" },
  contacted: { label: "Contacted", variant: "secondary" },
  meeting: { label: "Meeting", variant: "default" },
  proposal: { label: "Proposal", variant: "warning" },
  won: { label: "Won", variant: "success" },
  lost: { label: "Lost", variant: "outline" },
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  const config = statusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const tier = getScoreTier(score);
  const label = getScoreLabel(score);

  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex min-w-[2.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
          tier === "hot" && "bg-rose-50 text-rose-700",
          tier === "warm" && "bg-amber-50 text-amber-700",
          tier === "cold" && "bg-slate-100 text-slate-600"
        )}
        aria-label={`Lead score ${score}, ${label}`}
      >
        {score}
      </span>
      <span className="sr-only sm:not-sr-only sm:text-xs sm:text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
