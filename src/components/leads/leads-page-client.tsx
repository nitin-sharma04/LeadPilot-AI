"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Plus, Search, Download, Users, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ScoreBadge, StatusBadge } from "@/components/leads/badges";
import { AddLeadModal } from "@/components/leads/add-lead-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCurrency, formatDate } from "@/lib/format";
import { mapSourceToDb, mapStatusToDb } from "@/lib/mappers";
import { cn } from "@/lib/utils";
import type { Lead, LeadSource, LeadStatus, TeamMember } from "@/types";

const statusFilters: Array<"all" | LeadStatus> = [
  "all",
  "new",
  "hot",
  "qualified",
  "contacted",
  "meeting",
  "proposal",
  "won",
  "lost",
];

const sources: Array<"all" | LeadSource> = [
  "all",
  "Website",
  "Web Form",
  "Google Ads",
  "Meta Ads",
  "LinkedIn",
  "Facebook",
  "Referral",
  "Cold Outreach",
  "Partner",
  "CSV Import",
  "HubSpot",
  "Salesforce",
  "Other",
];

const scoreFilters = [
  { id: "all", label: "All scores" },
  { id: "hot", label: "Hot (90–100)" },
  { id: "warm", label: "Warm (70–89)" },
  { id: "cold", label: "Cold (<70)" },
] as const;

type LeadsPageClientProps = {
  initialLeads: Lead[];
  team: TeamMember[];
};

export function LeadsPageClient({ initialLeads, team }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | LeadStatus>("all");
  const [source, setSource] = useState<"all" | LeadSource>("all");
  const [scoreFilter, setScoreFilter] = useState<"all" | "hot" | "warm" | "cold">(
    "all"
  );
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const ownerNames = useMemo(
    () => Object.fromEntries(team.map((m) => [m.id, m.name])),
    [team]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      if (source !== "all") params.set("source", mapSourceToDb(source));
      if (scoreFilter !== "all") params.set("score", scoreFilter);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load leads");
      setLeads(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [query, status, source, scoreFilter]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void refresh();
    }, 250);
    return () => clearTimeout(handle);
  }, [refresh]);

  async function handleAdd(payload: {
    name: string;
    company: string;
    email: string;
    phone: string;
    source: LeadSource;
    dealValue: number;
    message: string;
  }) {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        companyName: payload.company,
        email: payload.email,
        phone: payload.phone,
        source: mapSourceToDb(payload.source),
        dealValue: payload.dealValue,
        message: payload.message,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error || "Unable to create lead");
      return;
    }
    setLeads((prev) => [json.data, ...prev]);
    toast.success("Lead saved to your workspace.");
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error || "Unable to delete lead");
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== id));
    toast.success("Lead deleted.");
  }

  async function handleStatusChange(id: string, next: LeadStatus) {
    if (next === "hot") return;
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: mapStatusToDb(next) }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error || "Unable to update status");
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === id ? json.data : l)));
    toast.success("Status updated.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Manage, qualify and track every sales opportunity."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/dashboard/leads/import">
                <Upload className="h-4 w-4" />
                Import
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => toast("CSV export will arrive in a later phase.")}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Lead
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search leads, companies, emails…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search leads"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                aria-label="Filter by source"
              >
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s === "all" ? "All sources" : s}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-card px-3 text-sm"
                value={scoreFilter}
                onChange={(e) =>
                  setScoreFilter(e.target.value as typeof scoreFilter)
                }
                aria-label="Filter by score"
              >
                {scoreFilters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStatus(item)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  status === item
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title={loading ? "Loading leads…" : "No leads match your filters"}
          description="Try adjusting search, status, source, or score filters to see results."
          actionLabel="Clear filters"
          onAction={() => {
            setQuery("");
            setStatus("all");
            setSource("all");
            setScoreFilter("all");
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Lead</th>
                    <th className="px-3 py-3 font-medium">Company</th>
                    <th className="px-3 py-3 font-medium">Source</th>
                    <th className="px-3 py-3 font-medium">Score</th>
                    <th className="px-3 py-3 font-medium">Deal Value</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Owner</th>
                    <th className="px-3 py-3 font-medium">Created</th>
                    <th className="px-5 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-border/70 last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {lead.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{lead.email}</p>
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {lead.company}
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {lead.source}
                      </td>
                      <td className="px-3 py-3.5">
                        <ScoreBadge score={lead.score} />
                      </td>
                      <td className="px-3 py-3.5 tabular-nums font-medium">
                        {formatCurrency(lead.dealValue)}
                      </td>
                      <td className="px-3 py-3.5">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {ownerNames[lead.ownerId] ?? "—"}
                      </td>
                      <td className="px-3 py-3.5 text-muted-foreground">
                        {formatDate(lead.createdAt)}
                      </td>
                      <td className="relative px-5 py-3.5">
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Lead actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            <DropdownMenuItem asChild>
                              <Link href={`/dashboard/leads/${lead.id}`}>
                                View details
                              </Link>
                            </DropdownMenuItem>
                            {statusFilters
                              .filter((s) => s !== "all" && s !== "hot")
                              .map((s) => (
                                <DropdownMenuItem
                                  key={s}
                                  onSelect={() => handleStatusChange(lead.id, s)}
                                >
                                  Mark {s}
                                </DropdownMenuItem>
                              ))}
                            <DropdownMenuItem
                              onSelect={() => handleDelete(lead.id)}
                              className="text-destructive"
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AddLeadModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={async (lead) => {
          await handleAdd({
            name: lead.name,
            company: lead.company,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
            dealValue: lead.dealValue,
            message: lead.message,
          });
        }}
      />
    </div>
  );
}
