import { Phone } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { CallsClient } from "@/components/calls/calls-client";
import { requireSession } from "@/lib/session";
import { listCalls } from "@/services/workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Calls",
};

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const user = await requireSession();
  const calls = await listCalls(user);

  if (calls.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Calls"
          description="Review AI and team call history, summaries, and next actions."
        />
        <EmptyState
          icon={Phone}
          title="No calls yet"
          description="Call history will appear here once calls are logged."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        description="Review call history, transcripts, and AI summaries from your workspace."
        actions={<Badge variant="secondary">Loaded from PostgreSQL</Badge>}
      />
      <CallsClient calls={calls} />
    </div>
  );
}
