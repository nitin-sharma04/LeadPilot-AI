import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InviteMemberButton } from "@/components/team/invite-member-button";
import { requireSession } from "@/lib/session";
import { listTeam } from "@/services/workspace";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

const statusStyles = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-slate-400",
} as const;

export default async function TeamPage() {
  const user = await requireSession();
  const teamMembers = await listTeam(user);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Manage sales roles, capacity, and performance across your workspace."
        actions={<InviteMemberButton />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teamMembers.map((member) => (
          <Card key={member.id} className="hover:shadow-md">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="relative">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback>{member.avatarInitials}</AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card",
                      statusStyles[member.status]
                    )}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{member.name}</p>
                      <p className="text-sm text-muted-foreground">{member.role}</p>
                    </div>
                    <Badge variant="secondary" className="capitalize">
                      {member.status}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {member.email}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
                <Stat label="Leads" value={formatNumber(member.leadsCount)} />
                <Stat
                  label="Meetings"
                  value={formatNumber(member.meetingsCount)}
                />
                <Stat label="Won" value={formatNumber(member.dealsWon)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
