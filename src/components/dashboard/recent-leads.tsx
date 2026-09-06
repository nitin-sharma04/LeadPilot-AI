import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBadge, StatusBadge } from "@/components/leads/badges";
import type { Lead } from "@/types";
import { formatCurrency } from "@/lib/format";

type RecentLeadsProps = {
  leads: Lead[];
  ownerNames: Record<string, string>;
};

export function RecentLeads({ leads, ownerNames }: RecentLeadsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Recent Leads</CardTitle>
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all leads
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium">Company</th>
                <th className="pb-3 pr-4 font-medium">Source</th>
                <th className="pb-3 pr-4 font-medium">Lead Score</th>
                <th className="pb-3 pr-4 font-medium">Deal Value</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-border/70 last:border-0 hover:bg-muted/40"
                >
                  <td className="py-3.5 pr-4">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {lead.name}
                    </Link>
                  </td>
                  <td className="py-3.5 pr-4 text-muted-foreground">{lead.company}</td>
                  <td className="py-3.5 pr-4 text-muted-foreground">{lead.source}</td>
                  <td className="py-3.5 pr-4">
                    <ScoreBadge score={lead.score} />
                  </td>
                  <td className="py-3.5 pr-4 tabular-nums font-medium">
                    {formatCurrency(lead.dealValue)}
                  </td>
                  <td className="py-3.5 pr-4">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="py-3.5 text-muted-foreground">
                    {ownerNames[lead.ownerId] ?? "Unassigned"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
