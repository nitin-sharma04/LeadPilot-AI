import type {
  Lead as DbLead,
  LeadSource as DbLeadSource,
  LeadStatus as DbLeadStatus,
  User,
} from "@prisma/client";
import type { Lead, LeadSource, LeadStatus, TeamMember } from "@/types";

const statusToUi: Record<DbLeadStatus, LeadStatus> = {
  NEW: "new",
  CONTACTED: "contacted",
  QUALIFIED: "qualified",
  MEETING: "meeting",
  PROPOSAL: "proposal",
  WON: "won",
  LOST: "lost",
};

const statusToDb: Record<Exclude<LeadStatus, "hot">, DbLeadStatus> = {
  new: "NEW",
  contacted: "CONTACTED",
  qualified: "QUALIFIED",
  meeting: "MEETING",
  proposal: "PROPOSAL",
  won: "WON",
  lost: "LOST",
};

const sourceToUi: Record<DbLeadSource, LeadSource> = {
  WEBSITE: "Website",
  GOOGLE_ADS: "Google Ads",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  REFERRAL: "Referral",
  MANUAL: "Cold Outreach",
  API: "Partner",
  WEB_FORM: "Web Form",
  CSV: "CSV Import",
  HUBSPOT: "HubSpot",
  SALESFORCE: "Salesforce",
  META_ADS: "Meta Ads",
  OTHER: "Other",
};

const sourceToDb: Partial<Record<LeadSource, DbLeadSource>> = {
  Website: "WEBSITE",
  "Google Ads": "GOOGLE_ADS",
  Facebook: "FACEBOOK",
  LinkedIn: "LINKEDIN",
  Referral: "REFERRAL",
  "Cold Outreach": "MANUAL",
  Partner: "API",
  "Web Form": "WEB_FORM",
  "CSV Import": "CSV",
  HubSpot: "HUBSPOT",
  Salesforce: "SALESFORCE",
  "Meta Ads": "META_ADS",
  Other: "OTHER",
};

export function mapStatusToUi(status: DbLeadStatus): LeadStatus {
  return statusToUi[status];
}

export function mapStatusToDb(status: LeadStatus): DbLeadStatus {
  if (status === "hot") return "NEW";
  return statusToDb[status];
}

export function mapSourceToUi(source: DbLeadSource): LeadSource {
  return sourceToUi[source];
}

export function mapSourceToDb(source: LeadSource): DbLeadSource {
  return sourceToDb[source] ?? "MANUAL";
}

export function mapLeadToUi(
  lead: DbLead & {
    analysis?: {
      estimatedBudget: string | null;
      recommendation: string | null;
    } | null;
  }
): Lead {
  return {
    id: lead.id,
    name: lead.name,
    company: lead.companyName,
    email: lead.email,
    phone: lead.phone ?? "",
    industry: lead.industry ?? "",
    source: mapSourceToUi(lead.source),
    score: lead.score,
    dealValue: lead.dealValue,
    status: mapStatusToUi(lead.status),
    ownerId: lead.assignedToId ?? "",
    createdAt: lead.createdAt.toISOString(),
    message: lead.message ?? "",
    intent: (lead.intent as Lead["intent"]) || "Medium",
    urgency: (lead.urgency as Lead["urgency"]) || "Medium",
    estimatedBudget:
      lead.analysis?.estimatedBudget ?? lead.budget ?? "To be determined",
    recommendedAction:
      lead.analysis?.recommendation ?? "Qualify this lead and schedule a first touch.",
  };
}

export function mapUserToTeamMember(
  user: User & {
    _count?: { assignedLeads?: number };
    leadsCount?: number;
    meetingsCount?: number;
    dealsWon?: number;
  }
): TeamMember {
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" "),
    status: "online",
    avatarInitials: initials,
    leadsCount: user.leadsCount ?? user._count?.assignedLeads ?? 0,
    meetingsCount: user.meetingsCount ?? 0,
    dealsWon: user.dealsWon ?? 0,
  };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
