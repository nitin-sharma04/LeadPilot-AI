import {
  AppointmentStatus,
  CallStatus,
  FollowUpStatus,
  LeadSource,
  LeadStatus,
  PrismaClient,
  TranscriptSpeaker,
  UserRole,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type SeedLead = {
  name: string;
  email: string;
  phone: string;
  companyName: string;
  industry: string;
  source: LeadSource;
  score: number;
  dealValue: number;
  status: LeadStatus;
  message: string;
  intent: string;
  urgency: string;
  budget: string;
  recommendation: string;
  ownerIndex: number;
};

const seedLeads: SeedLead[] = [
  {
    name: "Sarah Miller",
    email: "sarah.miller@apexdental.com",
    phone: "+1 (415) 555-0142",
    companyName: "Apex Dental",
    industry: "Healthcare",
    source: LeadSource.WEBSITE,
    score: 94,
    dealValue: 8000,
    status: LeadStatus.NEW,
    message:
      "I'm looking for a new website with online appointment booking. We'd like to launch before November and our budget is around $8,000.",
    intent: "High",
    urgency: "High",
    budget: "$5,000–$10,000",
    recommendation: "Contact this lead immediately.",
    ownerIndex: 0,
  },
  {
    name: "John Smith",
    email: "john@evergreenroofing.com",
    phone: "+1 (312) 555-0198",
    companyName: "Evergreen Roofing",
    industry: "Home Services",
    source: LeadSource.GOOGLE_ADS,
    score: 91,
    dealValue: 12000,
    status: LeadStatus.CONTACTED,
    message: "Need CRM and lead routing for roofing crews across three counties.",
    intent: "High",
    urgency: "High",
    budget: "$10,000–$15,000",
    recommendation: "Schedule a discovery call this week.",
    ownerIndex: 1,
  },
  {
    name: "Emma Davis",
    email: "emma.davis@novarealty.com",
    phone: "+1 (646) 555-0177",
    companyName: "Nova Realty",
    industry: "Real Estate",
    source: LeadSource.LINKEDIN,
    score: 82,
    dealValue: 6500,
    status: LeadStatus.MEETING,
    message: "Agents need better follow-up automation after open houses.",
    intent: "High",
    urgency: "Medium",
    budget: "$5,000–$8,000",
    recommendation: "Prepare a demo focused on open-house follow-ups.",
    ownerIndex: 2,
  },
  {
    name: "Michael Brown",
    email: "mike@brownfitness.com",
    phone: "+1 (206) 555-0133",
    companyName: "Brown Fitness",
    industry: "Fitness",
    source: LeadSource.FACEBOOK,
    score: 76,
    dealValue: 5000,
    status: LeadStatus.QUALIFIED,
    message: "Convert more trial memberships into paid plans with nurture sequences.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$4,000–$6,000",
    recommendation: "Send a trial-to-member conversion playbook.",
    ownerIndex: 0,
  },
  {
    name: "Olivia Chen",
    email: "olivia@summithome.io",
    phone: "+1 (503) 555-0164",
    companyName: "Summit Home Services",
    industry: "Home Services",
    source: LeadSource.GOOGLE_ADS,
    score: 88,
    dealValue: 9500,
    status: LeadStatus.PROPOSAL,
    message: "Storm season is approaching. Need faster response on estimate requests.",
    intent: "High",
    urgency: "High",
    budget: "$8,000–$12,000",
    recommendation: "Send proposal with storm-season SLA options.",
    ownerIndex: 1,
  },
  {
    name: "Daniel Torres",
    email: "d.torres@northstarlegal.com",
    phone: "+1 (212) 555-0181",
    companyName: "Northstar Legal",
    industry: "Legal",
    source: LeadSource.REFERRAL,
    score: 85,
    dealValue: 15000,
    status: LeadStatus.WON,
    message: "Need intake automation for personal injury consultations.",
    intent: "High",
    urgency: "Medium",
    budget: "$12,000–$18,000",
    recommendation: "Begin onboarding and kickoff scheduling.",
    ownerIndex: 0,
  },
  {
    name: "Rachel Nguyen",
    email: "rachel@brightpath.co",
    phone: "+1 (617) 555-0129",
    companyName: "BrightPath Consulting",
    industry: "Consulting",
    source: LeadSource.WEBSITE,
    score: 79,
    dealValue: 7200,
    status: LeadStatus.CONTACTED,
    message: "Shared pipeline view for BD team with strong reporting.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$6,000–$9,000",
    recommendation: "Share analytics dashboard walkthrough.",
    ownerIndex: 2,
  },
  {
    name: "Chris Walker",
    email: "chris@clearviewmkt.com",
    phone: "+1 (720) 555-0156",
    companyName: "ClearView Marketing",
    industry: "Marketing",
    source: LeadSource.REFERRAL,
    score: 93,
    dealValue: 11000,
    status: LeadStatus.NEW,
    message: "Need after-hours voice qualification and booking for inbound calls.",
    intent: "High",
    urgency: "High",
    budget: "$10,000–$14,000",
    recommendation: "Prioritize voice agent demo within 24 hours.",
    ownerIndex: 1,
  },
  {
    name: "Lauren Brooks",
    email: "lauren@harbordental.com",
    phone: "+1 (310) 555-0114",
    companyName: "Harbor Dental Group",
    industry: "Healthcare",
    source: LeadSource.LINKEDIN,
    score: 71,
    dealValue: 4800,
    status: LeadStatus.NEW,
    message: "Evaluating patient inquiry routing for multi-location group.",
    intent: "Medium",
    urgency: "Low",
    budget: "$4,000–$6,000",
    recommendation: "Send agency pricing one-pager.",
    ownerIndex: 2,
  },
  {
    name: "James Whitfield",
    email: "jwhitfield@pinecresthvac.com",
    phone: "+1 (858) 555-0190",
    companyName: "Pinecrest HVAC",
    industry: "Home Services",
    source: LeadSource.WEBSITE,
    score: 67,
    dealValue: 4200,
    status: LeadStatus.QUALIFIED,
    message: "Multi-location HVAC group evaluating patient-style inquiry routing.",
    intent: "Medium",
    urgency: "High",
    budget: "$3,000–$5,000",
    recommendation: "Offer starter plan with multi-location add-on.",
    ownerIndex: 2,
  },
  {
    name: "Amanda Foster",
    email: "amanda@blueoakins.com",
    phone: "+1 (704) 555-0172",
    companyName: "BlueOak Insurance",
    industry: "Insurance",
    source: LeadSource.GOOGLE_ADS,
    score: 90,
    dealValue: 13500,
    status: LeadStatus.MEETING,
    message: "AI call handling for emergency service requests and dispatch notes.",
    intent: "High",
    urgency: "High",
    budget: "$12,000–$16,000",
    recommendation: "Confirm meeting agenda with dispatch workflow focus.",
    ownerIndex: 0,
  },
  {
    name: "Kevin Morales",
    email: "kevin.morales@riverbendclinics.com",
    phone: "+1 (214) 555-0148",
    companyName: "Riverbend Clinics",
    industry: "Healthcare",
    source: LeadSource.MANUAL,
    score: 58,
    dealValue: 9000,
    status: LeadStatus.CONTACTED,
    message: "Exploring lead nurture after quote requests.",
    intent: "Low",
    urgency: "Low",
    budget: "$7,000–$11,000",
    recommendation: "Nurture with case study and follow up in 5 days.",
    ownerIndex: 1,
  },
  {
    name: "Natalie Brooks",
    email: "nbrooks@lumenstaffing.com",
    phone: "+1 (615) 555-0168",
    companyName: "Lumen Staffing",
    industry: "Staffing",
    source: LeadSource.REFERRAL,
    score: 86,
    dealValue: 16000,
    status: LeadStatus.PROPOSAL,
    message: "Four locations need unified lead intake and SMS follow-ups.",
    intent: "High",
    urgency: "Medium",
    budget: "$14,000–$20,000",
    recommendation: "Finalize proposal with multi-location pricing.",
    ownerIndex: 1,
  },
  {
    name: "Ethan Parker",
    email: "ethan@oaklinerenovations.com",
    phone: "+1 (919) 555-0139",
    companyName: "Oakline Renovations",
    industry: "Construction",
    source: LeadSource.FACEBOOK,
    score: 62,
    dealValue: 5500,
    status: LeadStatus.LOST,
    message: "Paused spend until next fiscal year.",
    intent: "Low",
    urgency: "Low",
    budget: "$4,000–$7,000",
    recommendation: "Add to Q1 re-engagement sequence.",
    ownerIndex: 2,
  },
  {
    name: "Sophia Martinez",
    email: "sophia@cascadepetcare.com",
    phone: "+1 (480) 555-0121",
    companyName: "Cascade Pet Care",
    industry: "Pet Services",
    source: LeadSource.LINKEDIN,
    score: 84,
    dealValue: 10500,
    status: LeadStatus.WON,
    message: "Faster candidate-company matching intake and automated first-touch.",
    intent: "High",
    urgency: "Medium",
    budget: "$9,000–$13,000",
    recommendation: "Kick off implementation with hiring workflow templates.",
    ownerIndex: 2,
  },
  {
    name: "Benjamin Hayes",
    email: "ben@vertexlogistics.com",
    phone: "+1 (971) 555-0187",
    companyName: "Vertex Logistics",
    industry: "Logistics",
    source: LeadSource.WEBSITE,
    score: 73,
    dealValue: 3800,
    status: LeadStatus.NEW,
    message: "Growing clinics need appointment reminders and inquiry scoring.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$3,000–$5,000",
    recommendation: "Qualify budget and expansion timeline.",
    ownerIndex: 2,
  },
  {
    name: "Grace Kim",
    email: "grace.kim@silverlinecpa.com",
    phone: "+1 (404) 555-0155",
    companyName: "Silverline Accounting",
    industry: "Accounting",
    source: LeadSource.GOOGLE_ADS,
    score: 95,
    dealValue: 18500,
    status: LeadStatus.NEW,
    message: "Enterprise freight brokerage evaluating sales automation for outreach.",
    intent: "High",
    urgency: "High",
    budget: "$15,000–$25,000",
    recommendation: "Escalate to sales manager and book executive demo.",
    ownerIndex: 0,
  },
  {
    name: "Thomas Reed",
    email: "treed@meadowbrookdental.com",
    phone: "+1 (303) 555-0108",
    companyName: "Meadowbrook Dental",
    industry: "Healthcare",
    source: LeadSource.REFERRAL,
    score: 77,
    dealValue: 6800,
    status: LeadStatus.QUALIFIED,
    message: "Better intake for new business clients and document request follow-ups.",
    intent: "Medium",
    urgency: "High",
    budget: "$5,000–$8,000",
    recommendation: "Propose seasonal campaign package.",
    ownerIndex: 1,
  },
  {
    name: "Isabella Cruz",
    email: "isabella@atlassecsolutions.com",
    phone: "+1 (512) 555-0193",
    companyName: "Atlas Security Solutions",
    industry: "Security",
    source: LeadSource.WEBSITE,
    score: 81,
    dealValue: 7500,
    status: LeadStatus.MEETING,
    message: "Scoring based on treatment interest and insurance status.",
    intent: "High",
    urgency: "Medium",
    budget: "$6,000–$9,000",
    recommendation: "Bring healthcare templates to the meeting.",
    ownerIndex: 1,
  },
  {
    name: "Ryan Cooper",
    email: "ryan@westfieldinteriors.com",
    phone: "+1 (702) 555-0144",
    companyName: "Westfield Interiors",
    industry: "Design",
    source: LeadSource.API,
    score: 69,
    dealValue: 8200,
    status: LeadStatus.PROPOSAL,
    message: "Lead routing by zip code and automatic quoting follow-ups.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$7,000–$10,000",
    recommendation: "Revise proposal with territory routing module.",
    ownerIndex: 2,
  },
  {
    name: "Hannah Price",
    email: "hannah@ironcladauto.com",
    phone: "+1 (615) 555-0117",
    companyName: "Ironclad Auto Group",
    industry: "Automotive",
    source: LeadSource.FACEBOOK,
    score: 54,
    dealValue: 3200,
    status: LeadStatus.NEW,
    message: "Small studio exploring CRM tools for social inquiries.",
    intent: "Low",
    urgency: "Low",
    budget: "$2,000–$4,000",
    recommendation: "Qualify fit for starter plan.",
    ownerIndex: 2,
  },
  {
    name: "Marcus Allen",
    email: "marcus@horizontutoring.com",
    phone: "+1 (313) 555-0161",
    companyName: "Horizon Tutoring",
    industry: "Education",
    source: LeadSource.GOOGLE_ADS,
    score: 92,
    dealValue: 14200,
    status: LeadStatus.CONTACTED,
    message: "AI voice qualification for service appointments after hours.",
    intent: "High",
    urgency: "High",
    budget: "$12,000–$18,000",
    recommendation: "Book multi-location ROI workshop.",
    ownerIndex: 0,
  },
  {
    name: "Chloe Bennett",
    email: "chloe@beaconpm.com",
    phone: "+1 (919) 555-0126",
    companyName: "Beacon Property Mgmt",
    industry: "Property Management",
    source: LeadSource.FACEBOOK,
    score: 64,
    dealValue: 2900,
    status: LeadStatus.LOST,
    message: "Chose a lighter tool for now due to budget.",
    intent: "Low",
    urgency: "Low",
    budget: "$2,000–$3,500",
    recommendation: "Re-engage with education discount offer next quarter.",
    ownerIndex: 1,
  },
  {
    name: "William Grant",
    email: "wgrant@northwindsolar.com",
    phone: "+1 (312) 555-0179",
    companyName: "Northwind Solar",
    industry: "Energy",
    source: LeadSource.MANUAL,
    score: 75,
    dealValue: 9800,
    status: LeadStatus.QUALIFIED,
    message: "Tenant inquiry triage and leasing follow-up automation.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$8,000–$12,000",
    recommendation: "Map regional team ownership before demo.",
    ownerIndex: 1,
  },
  {
    name: "Priya Shah",
    email: "priya@cedarandpine.co",
    phone: "+1 (206) 555-0188",
    companyName: "Cedar & Pine Retail",
    industry: "Retail",
    source: LeadSource.WEBSITE,
    score: 80,
    dealValue: 6100,
    status: LeadStatus.CONTACTED,
    message: "Need store lead capture from QR campaigns and SMS follow-up.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$5,000–$7,000",
    recommendation: "Demo retail lead capture templates.",
    ownerIndex: 0,
  },
  {
    name: "Noah Ellis",
    email: "noah@brightforge.io",
    phone: "+1 (512) 555-0199",
    companyName: "BrightForge Labs",
    industry: "Software",
    source: LeadSource.LINKEDIN,
    score: 89,
    dealValue: 22000,
    status: LeadStatus.PROPOSAL,
    message: "Outbound sales team needs call summaries synced into CRM.",
    intent: "High",
    urgency: "High",
    budget: "$18,000–$28,000",
    recommendation: "Include CRM sync roadmap in proposal.",
    ownerIndex: 0,
  },
  {
    name: "Maya Thompson",
    email: "maya@greenlanehvac.com",
    phone: "+1 (704) 555-0101",
    companyName: "Greenlane HVAC",
    industry: "Home Services",
    source: LeadSource.GOOGLE_ADS,
    score: 87,
    dealValue: 11200,
    status: LeadStatus.MEETING,
    message: "After-hours emergency call qualification is our top priority.",
    intent: "High",
    urgency: "High",
    budget: "$10,000–$14,000",
    recommendation: "Confirm voice agent demo with dispatch lead.",
    ownerIndex: 1,
  },
  {
    name: "Owen Bradley",
    email: "owen@lakecitydental.com",
    phone: "+1 (615) 555-0140",
    companyName: "Lake City Dental",
    industry: "Healthcare",
    source: LeadSource.WEBSITE,
    score: 70,
    dealValue: 5400,
    status: LeadStatus.NEW,
    message: "Want online booking plus lead scoring for high-value procedures.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$4,000–$7,000",
    recommendation: "Qualify procedure mix and booking volume.",
    ownerIndex: 2,
  },
  {
    name: "Ava Richardson",
    email: "ava@skylinemedia.co",
    phone: "+1 (213) 555-0166",
    companyName: "Skyline Media Group",
    industry: "Media",
    source: LeadSource.REFERRAL,
    score: 83,
    dealValue: 13200,
    status: LeadStatus.WON,
    message: "Agency wants white-label lead scoring for client accounts.",
    intent: "High",
    urgency: "Medium",
    budget: "$11,000–$16,000",
    recommendation: "Begin white-label onboarding.",
    ownerIndex: 0,
  },
  {
    name: "Liam Foster",
    email: "liam@coastalmarine.services",
    phone: "+1 (858) 555-0122",
    companyName: "Coastal Marine Services",
    industry: "Marine",
    source: LeadSource.API,
    score: 66,
    dealValue: 7800,
    status: LeadStatus.CONTACTED,
    message: "Seasonal booking spikes need automated follow-up sequences.",
    intent: "Medium",
    urgency: "Low",
    budget: "$6,000–$9,000",
    recommendation: "Share seasonal campaign case study.",
    ownerIndex: 2,
  },
  {
    name: "Zoe Harper",
    email: "zoe@urbanbloom.studio",
    phone: "+1 (347) 555-0180",
    companyName: "Urban Bloom Studio",
    industry: "Design",
    source: LeadSource.FACEBOOK,
    score: 72,
    dealValue: 4500,
    status: LeadStatus.QUALIFIED,
    message: "Looking for simple CRM with AI scoring for interior design leads.",
    intent: "Medium",
    urgency: "Medium",
    budget: "$3,500–$5,500",
    recommendation: "Demo starter plan with design industry templates.",
    ownerIndex: 1,
  },
  {
    name: "Henry Cole",
    email: "henry@ridgeviewlegal.com",
    phone: "+1 (212) 555-0194",
    companyName: "Ridgeview Legal",
    industry: "Legal",
    source: LeadSource.LINKEDIN,
    score: 91,
    dealValue: 17500,
    status: LeadStatus.MEETING,
    message: "Need conflict-check intake and consultation booking automation.",
    intent: "High",
    urgency: "High",
    budget: "$14,000–$20,000",
    recommendation: "Prepare legal intake workflow demo.",
    ownerIndex: 0,
  },
];

async function main() {
  const demoEmail = process.env.DEMO_EMAIL;
  const demoPassword = process.env.DEMO_PASSWORD;

  if (!demoEmail || !demoPassword) {
    throw new Error("DEMO_EMAIL and DEMO_PASSWORD must be set in the environment.");
  }

  console.log("Seeding LeadPilot AI demo workspace…");

  // SAFETY: Seed is for development/demo only.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_PROD_SEED=true only for intentional demo envs."
    );
  }

  if (process.env.SEED_WIPE === "true") {
    console.warn("[seed] SEED_WIPE=true — wiping ALL tenant data, then seeding Apex demo.");
    await prisma.notification.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.callTranscript.deleteMany();
    await prisma.callSummary.deleteMany();
    await prisma.call.deleteMany();
    await prisma.followUp.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.leadAnalysis.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.aIAgent.deleteMany();
    await prisma.user.deleteMany();
    await prisma.company.deleteMany();
  } else {
    console.warn(
      "[seed] Soft seed — removing only the previous demo company (if any). Other workspaces are preserved. Set SEED_WIPE=true to wipe everything."
    );
    const demoUser = await prisma.user.findUnique({
      where: { email: demoEmail.toLowerCase() },
    });
    if (demoUser) {
      await prisma.company.delete({ where: { id: demoUser.companyId } }).catch(() => undefined);
    }
    await prisma.company.deleteMany({
      where: { OR: [{ isDemo: true }, { name: "Apex Digital Solutions" }] },
    });
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const managerHash = await bcrypt.hash(demoPassword, 12);

  const company = await prisma.company.create({
    data: {
      name: "Apex Digital Solutions",
      industry: "Sales Technology",
      website: "https://apexdigitalsolutions.example",
      description:
        "Boutique growth agency helping service businesses convert inbound demand with AI-assisted sales workflows.",
      isDemo: true,
      onboardingCompletedAt: new Date(),
      timezone: "America/New_York",
    },
  });

  const owner = await prisma.user.create({
    data: {
      name: "Alex Johnson",
      email: demoEmail.toLowerCase(),
      passwordHash,
      role: UserRole.OWNER,
      companyId: company.id,
      image: null,
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: "Sarah Williams",
      email: "sarah.williams@apexdigitalsolutions.com",
      passwordHash: managerHash,
      role: UserRole.MANAGER,
      companyId: company.id,
    },
  });

  const rep = await prisma.user.create({
    data: {
      name: "Mike Davis",
      email: "mike.davis@apexdigitalsolutions.com",
      passwordHash: managerHash,
      role: UserRole.SALES_REP,
      companyId: company.id,
    },
  });

  const users = [owner, manager, rep];

  await prisma.aIAgent.create({
    data: {
      companyId: company.id,
      name: "Alex",
      voice: "professional-female",
      tone: "consultative",
      greeting:
        "Hi, this is Alex from Apex Digital Solutions calling about your recent inquiry. Do you have a quick minute to chat?",
      companyInformation:
        "Apex Digital Solutions helps service businesses capture, score, and convert leads with AI-powered outreach and pipeline automation.",
      qualificationQuestions: [
        "What service are you interested in?",
        "What is your approximate budget?",
        "When would you like to get started?",
        "Are you currently comparing other providers?",
      ],
    },
  });

  const createdLeads = [];
  for (const [index, item] of seedLeads.entries()) {
    const assignee = users[item.ownerIndex] ?? owner;
    const createdAt = new Date(Date.now() - (seedLeads.length - index) * 36e5 * 8);
    const override =
      item.email === "sarah.miller@apexdental.com"
        ? {
            buyingStage: "ready_to_buy",
            requirements: [
              "Website redesign",
              "Online appointment booking",
              "Launch before November",
            ],
            painPoints: ["Outdated website", "Difficult booking experience"],
            objections: [] as string[],
            reasoning:
              "Seeded demo analysis (not live OpenAI). Clear requirement, stated ~$8,000 budget, and a November launch deadline are strong buying signals.",
          }
        : item.email === "hannah@ironcladauto.com"
          ? {
              buyingStage: "unknown",
              requirements: [] as string[],
              painPoints: [] as string[],
              objections: ["Unclear budget", "Exploratory inquiry"],
              reasoning:
                "Seeded demo analysis (not live OpenAI). Vague interest with limited commercial detail — lower priority until qualified.",
            }
          : null;

    const lead = await prisma.lead.create({
      data: {
        companyId: company.id,
        assignedToId: assignee.id,
        name: item.name,
        email: item.email,
        phone: item.phone,
        companyName: item.companyName,
        industry: item.industry,
        source: item.source,
        message: item.message,
        budget: item.budget,
        timeline: item.urgency === "High" ? "This quarter" : "Next quarter",
        score: item.score,
        intent: item.intent,
        urgency: item.urgency,
        status: item.status,
        dealValue: item.dealValue,
        createdAt,
        analysis: {
          create: {
            score: item.score,
            intent: item.intent,
            urgency: item.urgency,
            estimatedBudget: item.budget,
            industry: item.industry,
            buyingStage:
              override?.buyingStage ??
              (item.score >= 90
                ? "ready_to_buy"
                : item.score >= 70
                  ? "evaluating"
                  : item.score >= 50
                    ? "researching"
                    : "unknown"),
            requirements:
              override?.requirements ??
              (item.score >= 70
                ? [
                    item.message.split(".")[0]?.trim() ||
                      "Business requirement stated",
                    "Follow-up / conversion support",
                  ]
                : item.message
                  ? ["General inquiry"]
                  : []),
            painPoints:
              override?.painPoints ??
              (item.urgency === "High"
                ? ["Time-sensitive need", "Current process gaps"]
                : item.score < 50
                  ? []
                  : ["Unclear current tooling"]),
            objections:
              override?.objections ??
              (item.status === "LOST" || item.score < 55
                ? ["Budget or timing uncertainty"]
                : []),
            recommendation: item.recommendation,
            reasoning:
              override?.reasoning ??
              `Seeded demo analysis (not live OpenAI). Score ${item.score} reflects sample buying signals for client demos. Run "Analyze with AI" to generate a live assessment.`,
            source: "seed",
          },
        },
        activities: {
          create: {
            companyId: company.id,
            userId: assignee.id,
            type: "LEAD_CREATED",
            description: `${item.name} was added from ${item.source.replaceAll("_", " ").toLowerCase()}.`,
            createdAt,
          },
        },
      },
    });
    createdLeads.push(lead);
  }

  // Calls + transcripts + summaries for a subset
  const callTargets = createdLeads.filter((l) =>
    ["CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "WON", "NEW"].includes(l.status)
  ).slice(0, 10);

  for (const [i, lead] of callTargets.entries()) {
    const agent = users[i % users.length];
    const startedAt = new Date(Date.now() - (i + 1) * 86400000);
    const duration = 180 + i * 37;
    const call = await prisma.call.create({
      data: {
        companyId: company.id,
        leadId: lead.id,
        agentId: agent.id,
        provider: "seed",
        direction: "OUTBOUND",
        status: CallStatus.COMPLETED,
        phoneNumber: lead.phone,
        duration,
        outcome: lead.score >= 85 ? "Qualified" : "Callback",
        qualificationScore: Math.min(98, lead.score + 2),
        startedAt,
        endedAt: new Date(startedAt.getTime() + duration * 1000),
        transcripts: {
          create: [
            {
              speaker: TranscriptSpeaker.AI,
              message: `Thanks for reaching out. I understand you're exploring options for ${lead.companyName}.`,
              timestamp: startedAt,
            },
            {
              speaker: TranscriptSpeaker.LEAD,
              message: lead.message ?? "We're evaluating solutions this quarter.",
              timestamp: new Date(startedAt.getTime() + 20000),
            },
            {
              speaker: TranscriptSpeaker.AI,
              message: "Got it — what's your approximate budget and timeline?",
              timestamp: new Date(startedAt.getTime() + 45000),
            },
            {
              speaker: TranscriptSpeaker.LEAD,
              message: `Budget is roughly ${lead.budget ?? "flexible"} and urgency is ${lead.urgency}.`,
              timestamp: new Date(startedAt.getTime() + 70000),
            },
          ],
        },
        summary: {
          create: {
            intent: lead.intent,
            budget: lead.budget,
            timeline: lead.timeline,
            requirements: lead.message,
            objections: lead.score < 70 ? "Budget sensitivity" : null,
            nextAction:
              lead.score >= 85
                ? "Send proposal and book strategy consultation."
                : "Continue nurture sequence.",
            summary: `${lead.name} from ${lead.companyName} discussed needs around lead capture and follow-up. Intent ${lead.intent}, urgency ${lead.urgency}.`,
          },
        },
      },
    });

    await prisma.activity.create({
      data: {
        companyId: company.id,
        leadId: lead.id,
        userId: agent.id,
        type: "CALL_COMPLETED",
        description: `Call completed with ${lead.name} (${call.outcome}).`,
        createdAt: startedAt,
      },
    });
  }

  // Follow-ups for first 6 leads
  for (const lead of createdLeads.slice(0, 6)) {
    const base = new Date();
    const days = [0, 2, 5, 10];
    for (const [idx, day] of days.entries()) {
      const scheduledAt = new Date(base.getTime() + day * 86400000);
      let status: FollowUpStatus = FollowUpStatus.SCHEDULED;
      if (idx === 0) status = FollowUpStatus.COMPLETED;
      if (idx === 1) status = FollowUpStatus.SENT;
      if (lead.status === LeadStatus.LOST && idx === 2) status = FollowUpStatus.FAILED;

      await prisma.followUp.create({
        data: {
          companyId: company.id,
          leadId: lead.id,
          sequenceDay: day,
          message:
            day === 0
              ? "Initial response"
              : day === 2
                ? "Follow-up #1"
                : day === 5
                  ? "Follow-up #2"
                  : "Final follow-up",
          scheduledAt,
          status,
        },
      });
    }
  }

  // Appointments
  const meetingLeads = createdLeads
    .filter((l) =>
      (
        [LeadStatus.MEETING, LeadStatus.PROPOSAL, LeadStatus.NEW] as LeadStatus[]
      ).includes(l.status)
    )
    .slice(0, 6);

  for (const [i, lead] of meetingLeads.entries()) {
    const dateTime = new Date();
    dateTime.setDate(dateTime.getDate() + i + 1);
    dateTime.setHours(10 + (i % 5), i % 2 === 0 ? 0 : 30, 0, 0);

    await prisma.appointment.create({
      data: {
        companyId: company.id,
        leadId: lead.id,
        assignedToId: lead.assignedToId,
        title:
          i % 2 === 0
            ? "Website Strategy Consultation"
            : "Voice Agent Demo",
        dateTime,
        duration: i % 2 === 0 ? 45 : 30,
        status: AppointmentStatus.SCHEDULED,
        notes: `Demo meeting with ${lead.companyName}.`,
      },
    });
  }

  // Notifications for owner
  await prisma.notification.createMany({
    data: [
      {
        companyId: company.id,
        userId: owner.id,
        type: "HOT_LEAD",
        title: "New hot lead",
        message: "Grace Kim scored 95 and needs immediate outreach.",
        read: false,
      },
      {
        companyId: company.id,
        userId: owner.id,
        type: "MEETING",
        title: "Meeting tomorrow",
        message: "Website Strategy Consultation is on your calendar.",
        read: false,
      },
      {
        companyId: company.id,
        userId: owner.id,
        type: "PIPELINE",
        title: "Proposal ready",
        message: "Olivia Chen moved to Proposal stage.",
        read: true,
      },
      {
        companyId: company.id,
        userId: manager.id,
        type: "ASSIGNMENT",
        title: "Lead assigned",
        message: "You were assigned John Smith from Evergreen Roofing.",
        read: false,
      },
    ],
  });

  // Phase 7: default follow-up sequence + demo email account + sample DEMO emails
  const sequence = await prisma.followUpSequence.create({
    data: {
      companyId: company.id,
      name: "Standard nurture",
      description: "Intro → Day 2 → Day 4 → Day 7",
      isDefault: true,
      isActive: true,
      steps: {
        create: [
          { stepOrder: 1, delayDays: 0, emailType: "INTRO", tone: "PROFESSIONAL" },
          { stepOrder: 2, delayDays: 2, emailType: "FOLLOW_UP", tone: "FRIENDLY" },
          { stepOrder: 3, delayDays: 4, emailType: "FOLLOW_UP", tone: "CONCISE" },
          {
            stepOrder: 4,
            delayDays: 7,
            emailType: "RE_ENGAGEMENT",
            tone: "CONSULTATIVE",
          },
        ],
      },
    },
  });

  const demoEmailAccount = await prisma.emailAccount.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      provider: "DEMO",
      emailAddress: "demo.gmail@leadpilot.local",
      displayName: "Demo Gmail",
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      tokenExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      scopes: "demo",
      status: "DEMO",
    },
  });

  const sampleLead = createdLeads[0];
  if (sampleLead) {
    await prisma.emailMessage.create({
      data: {
        companyId: company.id,
        leadId: sampleLead.id,
        emailAccountId: demoEmailAccount.id,
        userId: owner.id,
        direction: "OUTBOUND",
        emailType: "INTRO",
        tone: "PROFESSIONAL",
        toAddress: sampleLead.email,
        subject: "[DEMO] Quick intro from Apex Digital",
        bodyText:
          "This is seeded DEMO email history — not a real Gmail send.\n\nWould Tuesday work for a short call?",
        status: "SENT",
        isDemo: true,
        sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        providerMessageId: "demo-seed-msg-1",
        threadId: "demo-seed-thread-1",
      },
    });
    await prisma.followUpEnrollment.create({
      data: {
        companyId: company.id,
        leadId: sampleLead.id,
        sequenceId: sequence.id,
        status: "ACTIVE",
        currentStepOrder: 2,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastRunAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log(`Seeded company: ${company.name}`);
  console.log(`Owner login email: ${demoEmail}`);
  console.log(`Users: ${users.length}, Leads: ${createdLeads.length}`);
  console.log(`Phase 7 sequence: ${sequence.name}, demo Gmail: ${demoEmailAccount.emailAddress}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
