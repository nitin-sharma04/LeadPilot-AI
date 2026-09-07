import { DashboardShell } from "@/components/layout/dashboard-shell";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    redirect("/login");
  }
  const user = session.user;
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: {
      name: true,
      isDemo: true,
      onboardingCompletedAt: true,
    },
  });

  if (
    company &&
    !company.isDemo &&
    !company.onboardingCompletedAt
  ) {
    redirect("/onboarding");
  }

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const roleLabel = user.role
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

  return (
    <DashboardShell
      user={{
        name: user.name,
        email: user.email,
        role: roleLabel,
        initials,
      }}
    >
      {company?.isDemo ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
          <p>
            <span className="font-medium">Demo workspace</span> — seeded Apex
            Digital data. Create a real account for your own company.
          </p>
          <Badge variant="warning">DEMO</Badge>
        </div>
      ) : null}
      {children}
    </DashboardShell>
  );
}
