"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNavbar } from "@/components/layout/top-navbar";

const titles: Record<string, { title: string; breadcrumb?: string }> = {
  "/dashboard": { title: "Overview", breadcrumb: "Dashboard" },
  "/dashboard/leads": { title: "Leads", breadcrumb: "Dashboard / Leads" },
  "/dashboard/pipeline": { title: "Pipeline", breadcrumb: "Dashboard / Pipeline" },
  "/dashboard/ai-agent": { title: "AI Agent", breadcrumb: "Dashboard / AI Agent" },
  "/dashboard/calls": { title: "Calls", breadcrumb: "Dashboard / Calls" },
  "/dashboard/follow-ups": {
    title: "Follow-ups",
    breadcrumb: "Dashboard / Follow-ups",
  },
  "/dashboard/appointments": {
    title: "Appointments",
    breadcrumb: "Dashboard / Appointments",
  },
  "/dashboard/analytics": {
    title: "Analytics",
    breadcrumb: "Dashboard / Analytics",
  },
  "/dashboard/team": { title: "Team", breadcrumb: "Dashboard / Team" },
  "/dashboard/integrations": {
    title: "Integrations",
    breadcrumb: "Dashboard / Integrations",
  },
  "/dashboard/settings": {
    title: "Settings",
    breadcrumb: "Dashboard / Settings",
  },
};

type DashboardShellProps = {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
    initials: string;
  };
};

export function DashboardShell({ children, user }: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const meta =
    titles[pathname] ??
    (pathname.startsWith("/dashboard/leads/")
      ? { title: "Lead Detail", breadcrumb: "Dashboard / Leads / Detail" }
      : { title: "LeadPilot AI", breadcrumb: "Dashboard" });

  return (
    <div className="min-h-screen">
      <Sidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        user={user}
      />
      <div className="lg:pl-64">
        <TopNavbar
          title={meta.title}
          breadcrumb={meta.breadcrumb}
          onMenuClick={() => setMobileOpen(true)}
          userName={user.name}
          userEmail={user.email}
          userInitials={user.initials}
        />
        <main className="page-enter px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
