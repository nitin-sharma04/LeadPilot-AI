import type { TeamMember } from "@/types";

export const teamMembers: TeamMember[] = [
  {
    id: "tm-1",
    name: "Alex Johnson",
    email: "alex@leadpilot.ai",
    role: "Sales Manager",
    status: "online",
    avatarInitials: "AJ",
    leadsCount: 182,
    meetingsCount: 31,
    dealsWon: 18,
  },
  {
    id: "tm-2",
    name: "Sarah Williams",
    email: "sarah@leadpilot.ai",
    role: "Sales Representative",
    status: "online",
    avatarInitials: "SW",
    leadsCount: 145,
    meetingsCount: 27,
    dealsWon: 14,
  },
  {
    id: "tm-3",
    name: "Mike Davis",
    email: "mike@leadpilot.ai",
    role: "Sales Representative",
    status: "away",
    avatarInitials: "MD",
    leadsCount: 121,
    meetingsCount: 22,
    dealsWon: 11,
  },
  {
    id: "tm-4",
    name: "Jordan Lee",
    email: "jordan@leadpilot.ai",
    role: "Account Executive",
    status: "online",
    avatarInitials: "JL",
    leadsCount: 98,
    meetingsCount: 19,
    dealsWon: 9,
  },
  {
    id: "tm-5",
    name: "Priya Patel",
    email: "priya@leadpilot.ai",
    role: "SDR",
    status: "offline",
    avatarInitials: "PP",
    leadsCount: 76,
    meetingsCount: 14,
    dealsWon: 6,
  },
];

export function getTeamMember(id: string): TeamMember | undefined {
  return teamMembers.find((member) => member.id === id);
}

export const currentUser = teamMembers[0];
