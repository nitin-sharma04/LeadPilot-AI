import type { Metadata } from "next";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { requireSession } from "@/lib/session";
import { getAnalytics } from "@/services/analytics";

export const metadata: Metadata = {
  title: "Analytics",
};

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await requireSession();
  const data = await getAnalytics(user);

  return <AnalyticsDashboard data={data} />;
}
