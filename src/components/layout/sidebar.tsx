"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  Kanban,
  Bot,
  Phone,
  RefreshCw,
  CalendarDays,
  BarChart3,
  UsersRound,
  Puzzle,
  Settings,
  HelpCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const mainNav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/dashboard/ai-agent", label: "AI Agent", icon: Bot },
  { href: "/dashboard/calls", label: "Calls", icon: Phone },
  { href: "/dashboard/follow-ups", label: "Follow-ups", icon: RefreshCw },
  { href: "/dashboard/appointments", label: "Appointments", icon: CalendarDays },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
];

const workspaceNav = [
  { href: "/dashboard/team", label: "Team", icon: UsersRound },
  { href: "/dashboard/integrations", label: "Integrations", icon: Puzzle },
];

function NavLink({
  href,
  label,
  icon: Icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-white/10 text-sidebar-active"
          : "text-sidebar-foreground hover:bg-white/5 hover:text-white"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-teal-300" : "text-sidebar-muted group-hover:text-slate-300"
        )}
      />
      {label}
    </Link>
  );
}

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  user: {
    name: string;
    email: string;
    role: string;
    initials: string;
  };
}

export function Sidebar({ mobileOpen = false, onClose, user }: SidebarProps) {
  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/dashboard" className="flex items-baseline gap-1" onClick={onClose}>
          <span className="text-sm font-bold tracking-[0.14em] text-white">LEADPILOT</span>
          <span className="text-sm font-semibold tracking-wide text-teal-300">AI</span>
        </Link>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </Button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Main
        </p>
        <div className="space-y-0.5">
          {mainNav.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onClose} />
          ))}
        </div>

        <p className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Workspace
        </p>
        <div className="space-y-0.5">
          {workspaceNav.map((item) => (
            <NavLink key={item.href} {...item} onNavigate={onClose} />
          ))}
        </div>
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        <div className="space-y-0.5">
          <NavLink
            href="/dashboard/settings"
            label="Settings"
            icon={Settings}
            onNavigate={onClose}
          />
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-white/5 hover:text-white"
            onClick={() => {
              onClose?.();
              toast("Help center will be available later.");
            }}
          >
            <HelpCircle className="h-4 w-4 text-sidebar-muted" />
            Help
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-teal-500/20 text-teal-200">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{user.name}</p>
            <p className="truncate text-xs text-slate-400">{user.role}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 bg-sidebar lg:block">
        {content}
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-slate-950/50 transition-opacity",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={onClose}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-[min(18rem,88vw)] bg-sidebar shadow-2xl transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {content}
        </aside>
      </div>
    </>
  );
}
