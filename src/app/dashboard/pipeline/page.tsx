import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/session";
import { listPipelineLeads, listTeam } from "@/services/workspace";

export const metadata: Metadata = {
  title: "Pipeline",
};

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const user = await requireSession();
  const [leads, team] = await Promise.all([
    listPipelineLeads(user),
    listTeam(user),
  ]);
  const ownerNames = Object.fromEntries(team.map((m) => [m.id, m.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Track opportunities across every stage of your sales process."
        actions={<Badge variant="secondary">Changes persist to PostgreSQL</Badge>}
      />
      <PipelineBoard initialLeads={leads} ownerNames={ownerNames} />
    </div>
  );
}
