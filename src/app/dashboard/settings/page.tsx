import type { Metadata } from "next";
import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Settings",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireSession();
  const company = await prisma.company.findFirst({
    where: { id: user.companyId },
    select: { name: true },
  });

  const roleLabel = user.role
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");

  return (
    <SettingsPageClient
      userName={user.name}
      userEmail={user.email}
      userRole={roleLabel}
      companyName={company?.name ?? "Your company"}
    />
  );
}
