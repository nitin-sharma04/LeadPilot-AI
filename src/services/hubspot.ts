/**
 * HubSpot CRM integration — OAuth + contact import/export.
 * Demo mode when HUBSPOT_DEMO=true or credentials missing.
 * Never log tokens.
 */

import { CrmConnectionStatus, CrmProvider, LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { getAppUrl } from "@/lib/app-url";
import { createLeadRecord } from "@/services/leads";
import { signGoogleOAuthState, verifySignedState } from "@/lib/calendar/google-oauth-state";

export function isHubSpotDemoMode() {
  const flag = process.env.HUBSPOT_DEMO?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  return !process.env.HUBSPOT_CLIENT_ID?.trim();
}

export function isHubSpotConfigured() {
  if (isHubSpotDemoMode()) return true;
  return Boolean(
    process.env.HUBSPOT_CLIENT_ID?.trim() &&
      process.env.HUBSPOT_CLIENT_SECRET?.trim()
  );
}

function hubspotRedirectUri() {
  return (
    process.env.HUBSPOT_REDIRECT_URI?.trim() ||
    `${getAppUrl()}/api/integrations/hubspot/callback`
  );
}

export function buildHubSpotAuthUrl(state: string) {
  if (isHubSpotDemoMode()) {
    throw new AppError("Demo HubSpot mode — use demo connect path", 400);
  }
  const clientId = process.env.HUBSPOT_CLIENT_ID!.trim();
  const scopes = [
    "crm.objects.contacts.read",
    "crm.objects.contacts.write",
    "oauth",
  ].join(" ");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: hubspotRedirectUri(),
    scope: scopes,
    state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeHubSpotCode(code: string) {
  const clientId = process.env.HUBSPOT_CLIENT_ID?.trim();
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new AppError("HubSpot is not configured", 503);
  }
  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: hubspotRedirectUri(),
      code,
    }),
  });
  if (!res.ok) {
    throw new AppError("HubSpot token exchange failed", 502);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiryDate: new Date(Date.now() + (json.expires_in || 3600) * 1000),
  };
}

export async function getHubSpotStatus(companyId: string, _userId?: string) {
  const conn = await prisma.crmConnection.findUnique({
    where: {
      companyId_provider: { companyId, provider: CrmProvider.HUBSPOT },
    },
    select: {
      id: true,
      status: true,
      accountLabel: true,
      lastSyncedAt: true,
      lastSyncError: true,
      provider: true,
    },
  });
  return {
    configured: isHubSpotConfigured(),
    connected: Boolean(conn && conn.status !== "DISCONNECTED"),
    demo: isHubSpotDemoMode() || conn?.status === "DEMO",
    accountLabel: conn?.accountLabel ?? null,
    lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: conn?.lastSyncError ?? null,
  };
}

export async function connectHubSpotDemo(companyId: string, userId: string) {
  await prisma.crmConnection.upsert({
    where: {
      companyId_provider: { companyId, provider: CrmProvider.HUBSPOT },
    },
    create: {
      companyId,
      userId,
      provider: CrmProvider.HUBSPOT,
      status: CrmConnectionStatus.DEMO,
      accountLabel: "demo.hubspot@leadpilot.local",
      accessToken: "demo-hubspot-token",
      refreshToken: "demo-hubspot-refresh",
      tokenExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      scopes: "demo",
    },
    update: {
      status: CrmConnectionStatus.DEMO,
      accountLabel: "demo.hubspot@leadpilot.local",
      accessToken: "demo-hubspot-token",
      lastSyncError: null,
    },
  });
}

export async function disconnectHubSpot(companyId: string) {
  await prisma.crmConnection.deleteMany({
    where: { companyId, provider: CrmProvider.HUBSPOT },
  });
}

export async function importHubSpotContacts(input: {
  companyId: string;
  userId: string;
  limit?: number;
}): Promise<{ imported: number; duplicates: number; demo: boolean }> {
  const conn = await prisma.crmConnection.findUnique({
    where: {
      companyId_provider: {
        companyId: input.companyId,
        provider: CrmProvider.HUBSPOT,
      },
    },
  });
  if (!conn || conn.status === "DISCONNECTED") {
    throw new AppError("HubSpot is not connected", 400);
  }

  if (conn.status === "DEMO" || conn.accessToken.startsWith("demo-")) {
    // Seed a few DEMO contacts
    let imported = 0;
    let duplicates = 0;
    const demos = [
      {
        id: "demo-hs-1",
        email: "demo.contact1@example.com",
        firstname: "Demo",
        lastname: "Contact One",
        company: "Demo Co",
        phone: "+1 555 0100",
      },
      {
        id: "demo-hs-2",
        email: "demo.contact2@example.com",
        firstname: "Demo",
        lastname: "Contact Two",
        company: "Sample LLC",
        phone: "+1 555 0101",
      },
    ];
    for (const c of demos) {
      const r = await createLeadRecord({
        companyId: input.companyId,
        name: `${c.firstname} ${c.lastname}`.trim(),
        email: c.email,
        phone: c.phone,
        companyName: c.company,
        source: LeadSource.HUBSPOT,
        actorUserId: input.userId,
        activityType: "LEAD_IMPORTED",
        activityDescription: `[DEMO] Imported from HubSpot (${c.id})`,
        external: { provider: "HUBSPOT", externalId: c.id },
        runAutomation: false,
      });
      if (r.created) imported += 1;
      else duplicates += 1;
    }
    await prisma.crmConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });
    return { imported, duplicates, demo: true };
  }

  // Live HubSpot contacts search
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts?limit=${input.limit ?? 20}&properties=email,firstname,lastname,phone,company`,
    { headers: { Authorization: `Bearer ${conn.accessToken}` } }
  );
  if (!res.ok) {
    await prisma.crmConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncError: `Import failed (${res.status})`,
        status: CrmConnectionStatus.ERROR,
      },
    });
    throw new AppError("Unable to import HubSpot contacts", 502);
  }

  const json = (await res.json()) as {
    results?: Array<{
      id: string;
      properties?: Record<string, string | null>;
    }>;
  };

  let imported = 0;
  let duplicates = 0;
  for (const row of json.results || []) {
    const p = row.properties || {};
    const email = (p.email || "").trim();
    if (!email) continue;
    const name =
      [p.firstname, p.lastname].filter(Boolean).join(" ").trim() || email;
    const r = await createLeadRecord({
      companyId: input.companyId,
      name,
      email,
      phone: p.phone || null,
      companyName: p.company || "Unknown",
      source: LeadSource.HUBSPOT,
      actorUserId: input.userId,
      activityType: "LEAD_IMPORTED",
      activityDescription: `Imported from HubSpot (${row.id})`,
      external: { provider: "HUBSPOT", externalId: row.id },
      runAutomation: true,
    });
    if (r.created) imported += 1;
    else duplicates += 1;
  }

  await prisma.crmConnection.update({
    where: { id: conn.id },
    data: {
      lastSyncedAt: new Date(),
      lastSyncError: null,
      status: CrmConnectionStatus.CONNECTED,
    },
  });

  return { imported, duplicates, demo: false };
}

/**
 * Push LeadPilot lead to HubSpot when connected.
 * Policy: HubSpot owns CRM contact id; LeadPilot owns AI score/intent.
 * Shared fields (name/email/phone/company) last-write from LeadPilot on update.
 */
export async function maybePushLeadToHubSpot(input: {
  companyId: string;
  leadId: string;
}) {
  const conn = await prisma.crmConnection.findUnique({
    where: {
      companyId_provider: {
        companyId: input.companyId,
        provider: CrmProvider.HUBSPOT,
      },
    },
  });
  if (!conn || conn.status === "DISCONNECTED") return { skipped: true };
  if (conn.status === "DEMO" || conn.accessToken.startsWith("demo-")) {
    return { skipped: true, demo: true };
  }

  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: { externalIdentities: true },
  });
  if (!lead) return { skipped: true };

  const existing = lead.externalIdentities.find(
    (e) => e.provider === CrmProvider.HUBSPOT
  );
  const props = {
    email: lead.email,
    firstname: lead.name.split(" ")[0] || lead.name,
    lastname: lead.name.split(" ").slice(1).join(" ") || "",
    phone: lead.phone || "",
    company: lead.companyName,
  };

  try {
    if (existing) {
      const res = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${existing.externalId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${conn.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties: props }),
        }
      );
      if (!res.ok) throw new Error(`HubSpot update ${res.status}`);
      await prisma.leadExternalIdentity.update({
        where: { id: existing.id },
        data: { syncStatus: "SYNCED", lastSyncedAt: new Date(), lastSyncError: null },
      });
    } else {
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties: props }),
      });
      if (!res.ok) throw new Error(`HubSpot create ${res.status}`);
      const json = (await res.json()) as { id: string };
      await prisma.leadExternalIdentity.create({
        data: {
          companyId: input.companyId,
          leadId: lead.id,
          provider: CrmProvider.HUBSPOT,
          externalId: json.id,
          syncStatus: "SYNCED",
          lastSyncedAt: new Date(),
        },
      });
    }
    await prisma.activity.create({
      data: {
        companyId: input.companyId,
        leadId: lead.id,
        type: "CRM_SYNCED",
        description: "Lead synced to HubSpot",
      },
    });
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "sync failed";
    if (existing) {
      await prisma.leadExternalIdentity.update({
        where: { id: existing.id },
        data: { syncStatus: "FAILED", lastSyncError: msg },
      });
    }
    await prisma.activity.create({
      data: {
        companyId: input.companyId,
        leadId: lead.id,
        type: "CRM_SYNC_FAILED",
        description: `HubSpot sync failed: ${msg}`,
      },
    });
    return { ok: false, error: msg };
  }
}

export { signGoogleOAuthState, verifySignedState };
