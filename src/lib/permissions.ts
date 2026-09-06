import { UserRole } from "@prisma/client";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";

/** Product-facing role: MEMBER maps to SALES_REP in the database. */
export type ProductRole = "OWNER" | "ADMIN" | "MANAGER" | "MEMBER";

export function toProductRole(role: UserRole): ProductRole {
  if (role === UserRole.SALES_REP) return "MEMBER";
  return role as ProductRole;
}

export type Permission =
  | "workspace.settings"
  | "team.manage"
  | "integrations.manage"
  | "leads.all"
  | "leads.assigned"
  | "calls.manage"
  | "appointments.manage"
  | "email.manage"
  | "automation.manage"
  | "analytics.view"
  | "billing.manage";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: [
    "workspace.settings",
    "team.manage",
    "integrations.manage",
    "leads.all",
    "leads.assigned",
    "calls.manage",
    "appointments.manage",
    "email.manage",
    "automation.manage",
    "analytics.view",
    "billing.manage",
  ],
  ADMIN: [
    "workspace.settings",
    "team.manage",
    "integrations.manage",
    "leads.all",
    "leads.assigned",
    "calls.manage",
    "appointments.manage",
    "email.manage",
    "automation.manage",
    "analytics.view",
  ],
  MANAGER: [
    "leads.all",
    "leads.assigned",
    "calls.manage",
    "appointments.manage",
    "email.manage",
    "automation.manage",
    "analytics.view",
  ],
  SALES_REP: [
    "leads.assigned",
    "calls.manage",
    "appointments.manage",
    "email.manage",
  ],
};

export function hasPermission(user: SessionUser, permission: Permission) {
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function requirePermission(user: SessionUser, permission: Permission) {
  if (!hasPermission(user, permission)) {
    throw new AppError("You do not have permission for this action", 403);
  }
}

export function requireOwnerOrAdmin(user: SessionUser) {
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    throw new AppError("Only owners and admins can perform this action", 403);
  }
}

/**
 * Assert a resource belongs to the session company.
 * Never trust client-supplied companyId.
 */
export function assertSameCompany(
  resourceCompanyId: string | null | undefined,
  user: SessionUser,
  label = "Resource"
) {
  if (!resourceCompanyId || resourceCompanyId !== user.companyId) {
    throw new AppError(`${label} not found`, 404);
  }
}
