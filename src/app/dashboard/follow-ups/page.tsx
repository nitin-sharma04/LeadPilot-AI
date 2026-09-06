import { PageHeader } from "@/components/shared/page-header";
import { FollowUpSequencesClient } from "@/components/follow-ups/follow-up-sequences-client";
import { requireSession } from "@/lib/session";
import { ensureDefaultSequence } from "@/services/follow-up-sequences";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Follow-ups",
};

export const dynamic = "force-dynamic";

export default async function FollowUpsPage() {
  const user = await requireSession();
  await ensureDefaultSequence(user.companyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description="Automated email nurture sequences with reply-aware auto-stop."
      />
      <FollowUpSequencesClient />
    </div>
  );
}
