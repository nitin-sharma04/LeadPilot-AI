"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScoreBadge } from "@/components/leads/badges";
import { formatCurrency } from "@/lib/format";
import { mapStatusToDb } from "@/lib/mappers";
import type { Lead, LeadStatus } from "@/types";
import { cn } from "@/lib/utils";

const columns: Exclude<LeadStatus, "hot">[] = [
  "new",
  "qualified",
  "contacted",
  "meeting",
  "proposal",
  "won",
  "lost",
];

const labels: Record<Exclude<LeadStatus, "hot">, string> = {
  new: "New",
  qualified: "Qualified",
  contacted: "Contacted",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

type PipelineBoardProps = {
  initialLeads: Lead[];
  ownerNames: Record<string, string>;
};

export function PipelineBoard({ initialLeads, ownerNames }: PipelineBoardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(
      columns.map((c) => [c, [] as Lead[]])
    ) as Record<Exclude<LeadStatus, "hot">, Lead[]>;
    leads.forEach((lead) => {
      const status = (
        columns.includes(lead.status as Exclude<LeadStatus, "hot">)
          ? lead.status
          : "new"
      ) as Exclude<LeadStatus, "hot">;
      map[status].push(lead);
    });
    return map;
  }, [leads]);

  async function moveLead(id: string, status: Exclude<LeadStatus, "hot">) {
    const previous = leads;
    setLeads((prev) =>
      prev.map((lead) => (lead.id === id ? { ...lead, status } : lead))
    );

    const res = await fetch(`/api/pipeline/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: mapStatusToDb(status) }),
    });
    const json = await res.json();
    if (!res.ok) {
      setLeads(previous);
      toast.error(json.error || "Unable to update pipeline");
      return;
    }
    setLeads((prev) => prev.map((lead) => (lead.id === id ? json.data : lead)));
    toast.success(`Moved to ${labels[status]}`);
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((column) => (
        <div
          key={column}
          className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-muted/30"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{labels[column]}</h3>
              <span className="rounded-md bg-card px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {grouped[column].length}
              </span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatCurrency(
                grouped[column].reduce((sum, l) => sum + l.dealValue, 0)
              )}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 p-2.5">
            {grouped[column].map((lead) => (
              <Card
                key={lead.id}
                className={cn("shadow-none transition-shadow hover:shadow-md")}
              >
                <CardHeader className="flex flex-row items-start justify-between space-y-0 p-3.5 pb-2">
                  <div>
                    <CardTitle className="text-sm">{lead.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {lead.company}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Change status for ${lead.name}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {columns.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          disabled={status === lead.status}
                          onClick={() => moveLead(lead.id, status)}
                        >
                          Move to {labels[status]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-2.5 p-3.5 pt-0">
                  <div className="flex items-center justify-between">
                    <ScoreBadge score={lead.score} />
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(lead.dealValue)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ownerNames[lead.ownerId] ?? "Unassigned"}
                  </p>
                </CardContent>
              </Card>
            ))}
            {grouped[column].length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                No leads in this stage
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
