import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireSession();
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: {
      name: true,
      industry: true,
      timezone: true,
      onboardingCompletedAt: true,
      isDemo: true,
    },
  });

  if (!company) redirect("/login");
  if (company.onboardingCompletedAt || company.isDemo) {
    redirect("/dashboard");
  }

  return (
    <OnboardingWizard
      initialCompanyName={company.name}
      initialIndustry={company.industry || "General"}
      initialTimezone={company.timezone}
    />
  );
}
