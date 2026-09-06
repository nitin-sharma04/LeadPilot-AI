import type {
  AiInsight,
  Appointment,
  CallRecord,
  FollowUpSequence,
  Integration,
  PerformancePoint,
} from "@/types";
import { leads } from "./leads";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export const calls: CallRecord[] = [
  {
    id: "call-1",
    leadId: "lead-1",
    agentId: "tm-1",
    duration: "03:42",
    outcome: "Qualified",
    qualificationScore: 92,
    date: "2026-09-04T15:10:00Z",
    transcriptPreview:
      "Alex: Thanks for reaching out to LeadPilot. I understand you're looking for a website with online booking before November...\nSarah: Yes, and we need it to integrate with our current scheduling software.",
    aiSummary:
      "Sarah confirmed budget around $8,000 and a hard launch target before November. High intent for appointment booking and website redesign. Recommended immediate proposal.",
    nextAction: "Send proposal and book strategy consultation.",
  },
  {
    id: "call-2",
    leadId: "lead-2",
    agentId: "tm-2",
    duration: "05:18",
    outcome: "Callback",
    qualificationScore: 88,
    date: "2026-09-03T14:30:00Z",
    transcriptPreview:
      "Sarah: Can you walk me through lead routing for field crews?\nJohn: We need zip-based assignment and after-hours coverage.",
    aiSummary:
      "John needs CRM routing across three counties with after-hours coverage. Strong fit for voice agent + pipeline. Requested a callback with operations manager present.",
    nextAction: "Schedule callback with operations manager.",
  },
  {
    id: "call-3",
    leadId: "lead-8",
    agentId: "tm-2",
    duration: "04:05",
    outcome: "Meeting Booked",
    qualificationScore: 95,
    date: "2026-09-05T16:45:00Z",
    transcriptPreview:
      "Chris: We miss too many after-hours calls. Can the agent book estimates automatically?\nAlex: Yes — we can qualify and schedule directly into your calendar.",
    aiSummary:
      "Chris is an urgent buyer for after-hours voice qualification and booking. Meeting booked for tomorrow. Estimated deal value $11,000.",
    nextAction: "Prepare voice agent demo for Summit Home Services.",
  },
  {
    id: "call-4",
    leadId: "lead-11",
    agentId: "tm-1",
    duration: "06:22",
    outcome: "Meeting Booked",
    qualificationScore: 90,
    date: "2026-08-27T11:20:00Z",
    transcriptPreview:
      "Amanda: Emergency HVAC calls spike in summer. Dispatch notes are critical.\nAlex: We can capture issue type, urgency, and address automatically.",
    aiSummary:
      "Amanda confirmed multi-tech dispatch needs and emergency call volume. Strong ROI narrative around missed emergency jobs.",
    nextAction: "Confirm meeting agenda with dispatch workflow focus.",
  },
  {
    id: "call-5",
    leadId: "lead-12",
    agentId: "tm-4",
    duration: "02:11",
    outcome: "Voicemail",
    qualificationScore: 40,
    date: "2026-08-23T09:55:00Z",
    transcriptPreview:
      "Jordan: Hi Kevin, following up on quote request nurture. Happy to share a short walkthrough when you're free.",
    aiSummary:
      "Left voicemail. Lead previously showed low urgency. Continue nurture sequence.",
    nextAction: "Send case study email and retry in 3 days.",
  },
  {
    id: "call-6",
    leadId: "lead-17",
    agentId: "tm-1",
    duration: "07:48",
    outcome: "Qualified",
    qualificationScore: 96,
    date: "2026-09-06T09:05:00Z",
    transcriptPreview:
      "Grace: We need CRM sync and call summaries for our shipper outreach team.\nAlex: We support HubSpot/Salesforce sync and post-call summaries out of the box in Phase 2.",
    aiSummary:
      "Enterprise-ready opportunity. Grace is evaluating CRM sync and call intelligence. High budget and clear buying committee.",
    nextAction: "Book executive demo with sales leadership.",
  },
  {
    id: "call-7",
    leadId: "lead-4",
    agentId: "tm-1",
    duration: "03:56",
    outcome: "Qualified",
    qualificationScore: 78,
    date: "2026-09-01T15:40:00Z",
    transcriptPreview:
      "Michael: Trial-to-paid conversion is our biggest leak. Can sequences help?\nAlex: Yes — timed SMS and call reminders convert well in fitness.",
    aiSummary:
      "Brown Fitness needs nurture sequences for trial members. Medium urgency, clear use case.",
    nextAction: "Send fitness conversion playbook.",
  },
  {
    id: "call-8",
    leadId: "lead-22",
    agentId: "tm-1",
    duration: "04:33",
    outcome: "Callback",
    qualificationScore: 91,
    date: "2026-09-04T18:05:00Z",
    transcriptPreview:
      "Marcus: After-hours service appointments are a priority. Sales walk-ins are secondary for now.",
    aiSummary:
      "Ironclad Auto Group prioritized service appointment qualification. High score, multi-location potential.",
    nextAction: "Book multi-location ROI workshop.",
  },
];

export const followUpSequences: FollowUpSequence[] = [
  {
    id: "fu-1",
    leadId: "lead-1",
    name: "Apex Dental — Website Inquiry",
    status: "scheduled",
    steps: [
      {
        id: "fu-1-0",
        day: 0,
        title: "Initial response",
        status: "completed",
        completedAt: "2026-09-04T14:40:00Z",
      },
      {
        id: "fu-1-1",
        day: 2,
        title: "Follow-up #1",
        status: "completed",
        completedAt: "2026-09-06T10:00:00Z",
      },
      {
        id: "fu-1-2",
        day: 5,
        title: "Follow-up #2",
        status: "scheduled",
        scheduledFor: "2026-09-09T10:00:00Z",
      },
      {
        id: "fu-1-3",
        day: 10,
        title: "Final follow-up",
        status: "scheduled",
        scheduledFor: "2026-09-14T10:00:00Z",
      },
    ],
  },
  {
    id: "fu-2",
    leadId: "lead-9",
    name: "ClearView — Agency Pricing",
    status: "pending",
    steps: [
      {
        id: "fu-2-0",
        day: 0,
        title: "Initial response",
        status: "pending",
        scheduledFor: "2026-09-06T12:00:00Z",
      },
      {
        id: "fu-2-1",
        day: 2,
        title: "Follow-up #1",
        status: "scheduled",
        scheduledFor: "2026-09-08T12:00:00Z",
      },
      {
        id: "fu-2-2",
        day: 5,
        title: "Follow-up #2",
        status: "scheduled",
        scheduledFor: "2026-09-11T12:00:00Z",
      },
      {
        id: "fu-2-3",
        day: 10,
        title: "Final follow-up",
        status: "scheduled",
        scheduledFor: "2026-09-16T12:00:00Z",
      },
    ],
  },
  {
    id: "fu-3",
    leadId: "lead-12",
    name: "BlueOak — Nurture Sequence",
    status: "failed",
    steps: [
      {
        id: "fu-3-0",
        day: 0,
        title: "Initial response",
        status: "completed",
        completedAt: "2026-08-22T11:00:00Z",
      },
      {
        id: "fu-3-1",
        day: 2,
        title: "Follow-up #1",
        status: "completed",
        completedAt: "2026-08-24T11:00:00Z",
      },
      {
        id: "fu-3-2",
        day: 5,
        title: "Follow-up #2",
        status: "failed",
        scheduledFor: "2026-08-27T11:00:00Z",
      },
      {
        id: "fu-3-3",
        day: 10,
        title: "Final follow-up",
        status: "scheduled",
        scheduledFor: "2026-09-01T11:00:00Z",
      },
    ],
  },
  {
    id: "fu-4",
    leadId: "lead-7",
    name: "BrightPath — Pipeline Demo",
    status: "completed",
    steps: [
      {
        id: "fu-4-0",
        day: 0,
        title: "Initial response",
        status: "completed",
        completedAt: "2026-09-05T09:10:00Z",
      },
      {
        id: "fu-4-1",
        day: 2,
        title: "Follow-up #1",
        status: "completed",
        completedAt: "2026-09-06T09:10:00Z",
      },
      {
        id: "fu-4-2",
        day: 5,
        title: "Follow-up #2",
        status: "completed",
        completedAt: "2026-09-06T14:00:00Z",
      },
      {
        id: "fu-4-3",
        day: 10,
        title: "Final follow-up",
        status: "completed",
        completedAt: "2026-09-06T14:05:00Z",
      },
    ],
  },
];

export const appointments: Appointment[] = [
  {
    id: "appt-1",
    leadId: "lead-1",
    title: "Website Strategy Consultation",
    date: "2026-09-07",
    time: "2:00 PM",
    duration: "45 min",
    location: "Google Meet",
    notes: "Focus on online booking and November launch timeline.",
    ownerId: "tm-1",
  },
  {
    id: "appt-2",
    leadId: "lead-8",
    title: "Voice Agent Demo",
    date: "2026-09-07",
    time: "10:30 AM",
    duration: "30 min",
    location: "Zoom",
    notes: "Demonstrate after-hours qualification and calendar booking.",
    ownerId: "tm-2",
  },
  {
    id: "appt-3",
    leadId: "lead-11",
    title: "Dispatch Workflow Review",
    date: "2026-09-08",
    time: "1:00 PM",
    duration: "60 min",
    location: "Microsoft Teams",
    notes: "Include operations lead. Review emergency call intake.",
    ownerId: "tm-1",
  },
  {
    id: "appt-4",
    leadId: "lead-3",
    title: "Open House Follow-up Demo",
    date: "2026-09-09",
    time: "11:00 AM",
    duration: "45 min",
    location: "Google Meet",
    notes: "Show AI scoring for buyer inquiries post open house.",
    ownerId: "tm-3",
  },
  {
    id: "appt-5",
    leadId: "lead-19",
    title: "Healthcare Intake Templates",
    date: "2026-09-10",
    time: "3:30 PM",
    duration: "30 min",
    location: "Zoom",
    notes: "Treatment interest scoring and insurance capture fields.",
    ownerId: "tm-2",
  },
  {
    id: "appt-6",
    leadId: "lead-17",
    title: "Executive Demo — Vertex Logistics",
    date: "2026-09-11",
    time: "9:00 AM",
    duration: "60 min",
    location: "Google Meet",
    notes: "CRM sync roadmap and call summary workflow.",
    ownerId: "tm-1",
  },
];

export const integrations: Integration[] = [
  {
    id: "int-1",
    name: "Google Calendar",
    description: "Sync meetings and availability.",
    status: "not_connected",
    category: "Calendar",
  },
  {
    id: "int-2",
    name: "Gmail",
    description: "Send and track follow-up emails.",
    status: "not_connected",
    category: "Email",
  },
  {
    id: "int-3",
    name: "Slack",
    description: "Notify your team about hot leads and booked meetings.",
    status: "not_connected",
    category: "Communication",
  },
  {
    id: "int-4",
    name: "HubSpot",
    description: "Sync contacts, deals, and pipeline stages.",
    status: "not_connected",
    category: "CRM",
  },
  {
    id: "int-5",
    name: "Salesforce",
    description: "Enterprise CRM sync for accounts and opportunities.",
    status: "not_connected",
    category: "CRM",
  },
  {
    id: "int-6",
    name: "Zapier",
    description: "Connect LeadPilot to thousands of other tools.",
    status: "not_connected",
    category: "Automation",
  },
];

export const aiInsights: AiInsight[] = [
  {
    id: "insight-1",
    title: "27 high-value leads haven't been contacted",
    description:
      "Demo insight: Several leads scoring 85+ are still in New or Hot without a first touch.",
    type: "alert",
  },
  {
    id: "insight-2",
    title: "Google Ads is generating your highest-value leads",
    description:
      "Demo insight: Average deal value from Google Ads outpaces other sources in this dataset.",
    type: "opportunity",
  },
  {
    id: "insight-3",
    title: "Leads contacted within 5 minutes convert stronger",
    description:
      "Demo insight: Fast response correlates with higher qualification rates in sample call history.",
    type: "tip",
  },
  {
    id: "insight-4",
    title: "Tuesday currently has the highest conversion rate",
    description:
      "Demo insight: Based on demo conversion timestamps, Tuesday outperforms other weekdays.",
    type: "trend",
  },
];

export const performanceSeries: PerformancePoint[] = [
  { date: "Aug 8", leads: 28, conversions: 3 },
  { date: "Aug 11", leads: 32, conversions: 4 },
  { date: "Aug 14", leads: 35, conversions: 3 },
  { date: "Aug 17", leads: 41, conversions: 5 },
  { date: "Aug 20", leads: 38, conversions: 4 },
  { date: "Aug 23", leads: 44, conversions: 6 },
  { date: "Aug 26", leads: 47, conversions: 5 },
  { date: "Aug 29", leads: 52, conversions: 7 },
  { date: "Sep 1", leads: 49, conversions: 6 },
  { date: "Sep 4", leads: 56, conversions: 8 },
  { date: "Sep 6", leads: 61, conversions: 9 },
];

/** Derived metrics from demo leads — keep dashboard numbers internally consistent */
export function computeLeadStats(dataset: typeof leads = leads) {
  const totalLeads = dataset.length;
  const hotLeads = dataset.filter((l) => l.score >= 90 || l.status === "hot").length;
  const wonDeals = dataset.filter((l) => l.status === "won");
  const qualified = dataset.filter((l) =>
    ["qualified", "meeting", "proposal", "won"].includes(l.status)
  );
  const meetings = dataset.filter((l) => l.status === "meeting").length;
  const activePipeline = dataset.filter(
    (l) => !["won", "lost"].includes(l.status)
  );
  const pipelineValue = activePipeline.reduce((sum, l) => sum + l.dealValue, 0);
  const revenue = wonDeals.reduce((sum, l) => sum + l.dealValue, 0);
  const conversionRate =
    totalLeads === 0 ? 0 : (wonDeals.length / totalLeads) * 100;
  const avgDealSize =
    wonDeals.length === 0
      ? 0
      : revenue / wonDeals.length;

  // Scale demo KPIs to feel like a mature SaaS product while staying
  // proportional to the sample set (display multipliers for demo realism).
  const displayTotalLeads = 1284;
  const displayHotLeads = 183;
  const displayConversion = 11.4;
  const displayPipeline = 284500;

  return {
    totalLeads,
    hotLeads,
    wonCount: wonDeals.length,
    qualifiedCount: qualified.length,
    meetings,
    pipelineValue,
    revenue,
    conversionRate,
    avgDealSize,
    display: {
      totalLeads: formatNumber(displayTotalLeads),
      hotLeads: formatNumber(displayHotLeads),
      conversionRate: formatPercent(displayConversion),
      pipelineValue: formatCurrency(displayPipeline),
      trends: {
        totalLeads: 18.2,
        hotLeads: 12.4,
        conversionRate: 2.8,
        pipelineValue: 24.6,
      },
    },
  };
}

export function getSourceDistribution(dataset: typeof leads = leads) {
  const map = new Map<string, number>();
  dataset.forEach((lead) => {
    map.set(lead.source, (map.get(lead.source) ?? 0) + 1);
  });
  return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
}

export function getFunnelData(dataset: typeof leads = leads) {
  const stages = [
    "new",
    "qualified",
    "contacted",
    "meeting",
    "proposal",
    "won",
  ] as const;
  return stages.map((stage) => ({
    name: stage.charAt(0).toUpperCase() + stage.slice(1),
    value: dataset.filter((l) => {
      if (stage === "new") return true;
      if (stage === "qualified")
        return ["qualified", "contacted", "meeting", "proposal", "won", "hot"].includes(
          l.status
        );
      if (stage === "contacted")
        return ["contacted", "meeting", "proposal", "won"].includes(l.status);
      if (stage === "meeting")
        return ["meeting", "proposal", "won"].includes(l.status);
      if (stage === "proposal") return ["proposal", "won"].includes(l.status);
      return l.status === "won";
    }).length,
  }));
}

export function getScoreDistribution(dataset: typeof leads = leads) {
  const buckets = [
    { name: "90–100", min: 90, max: 100 },
    { name: "70–89", min: 70, max: 89 },
    { name: "50–69", min: 50, max: 69 },
    { name: "0–49", min: 0, max: 49 },
  ];
  return buckets.map((b) => ({
    name: b.name,
    value: dataset.filter((l) => l.score >= b.min && l.score <= b.max).length,
  }));
}

export function getRevenueTrend() {
  return [
    { month: "Apr", revenue: 42000 },
    { month: "May", revenue: 51000 },
    { month: "Jun", revenue: 48000 },
    { month: "Jul", revenue: 62000 },
    { month: "Aug", revenue: 71000 },
    { month: "Sep", revenue: 26500 },
  ];
}
