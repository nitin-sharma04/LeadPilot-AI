export type LeadStatus =
  | "new"
  | "hot"
  | "qualified"
  | "contacted"
  | "meeting"
  | "proposal"
  | "won"
  | "lost";

export type LeadSource =
  | "Website"
  | "Google Ads"
  | "LinkedIn"
  | "Facebook"
  | "Referral"
  | "Cold Outreach"
  | "Partner"
  | "Web Form"
  | "CSV Import"
  | "HubSpot"
  | "Salesforce"
  | "Meta Ads"
  | "Other";

export type ScoreTier = "hot" | "warm" | "cold";

export type TeamMemberStatus = "online" | "away" | "offline";

export type CallOutcome =
  | "Qualified"
  | "Not Interested"
  | "Callback"
  | "Voicemail"
  | "Meeting Booked"
  | "No Answer";

export type FollowUpStatus = "pending" | "scheduled" | "completed" | "failed";

export type IntegrationStatus = "not_connected" | "available";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: TeamMemberStatus;
  avatarInitials: string;
  leadsCount: number;
  meetingsCount: number;
  dealsWon: number;
}

export interface Lead {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  industry: string;
  source: LeadSource;
  score: number;
  dealValue: number;
  status: LeadStatus;
  ownerId: string;
  createdAt: string;
  message: string;
  intent: "High" | "Medium" | "Low";
  urgency: "High" | "Medium" | "Low";
  estimatedBudget: string;
  recommendedAction: string;
}

export interface CallRecord {
  id: string;
  leadId: string;
  agentId: string;
  duration: string;
  outcome: CallOutcome;
  qualificationScore: number;
  date: string;
  transcriptPreview: string;
  aiSummary: string;
  nextAction: string;
}

export interface FollowUpStep {
  id: string;
  day: number;
  title: string;
  status: FollowUpStatus;
  scheduledFor?: string;
  completedAt?: string;
}

export interface FollowUpSequence {
  id: string;
  leadId: string;
  name: string;
  status: FollowUpStatus;
  steps: FollowUpStep[];
}

export interface Appointment {
  id: string;
  leadId: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  location: string;
  notes: string;
  ownerId: string;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  category: string;
}

export interface AiInsight {
  id: string;
  title: string;
  description: string;
  type: "alert" | "opportunity" | "tip" | "trend";
}

export interface PerformancePoint {
  date: string;
  leads: number;
  conversions: number;
}

export interface KpiMetric {
  id: string;
  title: string;
  value: string;
  trend: number;
  context: string;
  icon: "leads" | "hot" | "conversion" | "pipeline";
}
