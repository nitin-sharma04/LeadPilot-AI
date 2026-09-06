import type { Metadata } from "next";
import { LeadsPageClient } from "@/components/leads/leads-page-client";
import { requireSession } from "@/lib/session";
import { listLeads } from "@/services/leads";
import { listTeam } from "@/services/workspace";

export const metadata: Metadata = {
  title: "Leads",
};

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const user = await requireSession();
  const [leads, team] = await Promise.all([listLeads(user), listTeam(user)]);

  return <LeadsPageClient initialLeads={leads} team={team} />;
}
