"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  Calendar,
  Mail,
  MessageSquare,
  Puzzle,
  Workflow,
  Database,
  KeyRound,
  FormInput,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const icons: Record<string, ComponentType<{ className?: string }>> = {
  "Google Calendar": Calendar,
  Gmail: Mail,
  Slack: MessageSquare,
  HubSpot: Database,
  Salesforce: Workflow,
  Zapier: Puzzle,
  "Lead Capture API": KeyRound,
  "Web Forms": FormInput,
};

type ConnStatus = {
  configured: boolean;
  connected: boolean;
  demo?: boolean;
  googleEmail?: string | null;
  emailAddress?: string | null;
  accountLabel?: string | null;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
};

type CaptureKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
};

type CardDef = {
  id: string;
  name: string;
  category: string;
  description: string;
};

const cards: CardDef[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    category: "Scheduling",
    description: "Create calendar events when appointments are booked.",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "Email",
    description: "Send AI emails and run follow-up sequences from Gmail.",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    description: "Import HubSpot contacts and sync shared contact fields.",
  },
  {
    id: "lead-capture",
    name: "Lead Capture API",
    category: "Capture",
    description: "Workspace API keys for public lead intake and webhooks.",
  },
  {
    id: "web-forms",
    name: "Web Forms",
    category: "Capture",
    description: "Embeddable form and hosted capture page for your website.",
  },
];

function statusBadge(
  connected: boolean,
  demo?: boolean,
  error?: string | null
) {
  if (error) return <Badge variant="danger">Error</Badge>;
  if (connected && demo) return <Badge variant="secondary">Demo</Badge>;
  if (connected) return <Badge variant="info">Connected</Badge>;
  return <Badge variant="outline">Not connected</Badge>;
}

export default function IntegrationsPage() {
  const [google, setGoogle] = useState<ConnStatus | null>(null);
  const [gmail, setGmail] = useState<ConnStatus | null>(null);
  const [hubspot, setHubspot] = useState<ConnStatus | null>(null);
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [rawKeyOnce, setRawKeyOnce] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("Website form");

  async function load() {
    try {
      const [gRes, mRes, hRes, kRes] = await Promise.all([
        fetch("/api/integrations/google-calendar"),
        fetch("/api/integrations/gmail"),
        fetch("/api/integrations/hubspot"),
        fetch("/api/lead-capture-keys"),
      ]);
      const gJson = await gRes.json();
      const mJson = await mRes.json();
      const hJson = await hRes.json();
      const kJson = await kRes.json();
      if (gRes.ok) setGoogle(gJson.data);
      if (mRes.ok) setGmail(mJson.data);
      if (hRes.ok) setHubspot(hJson.data);
      if (kRes.ok) setKeys(kJson.data);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    const m = params.get("gmail");
    const h = params.get("hubspot");
    if (g === "connected") toast.success("Google Calendar connected");
    else if (g === "denied") toast.error("Google Calendar authorization denied");
    else if (g === "error") toast.error("Google Calendar connection failed");
    else if (g === "invalid" || g === "invalid_state")
      toast.error("Invalid Google OAuth response");
    if (m === "connected") toast.success("Gmail connected");
    else if (m === "denied") toast.error("Gmail authorization denied");
    else if (m === "error") toast.error("Gmail connection failed");
    else if (m === "invalid" || m === "invalid_state")
      toast.error("Invalid Gmail OAuth response");
    if (h === "connected") toast.success("HubSpot connected");
    else if (h === "denied") toast.error("HubSpot authorization denied");
    else if (h === "error") toast.error("HubSpot connection failed");
    else if (h === "invalid" || h === "invalid_state")
      toast.error("Invalid HubSpot OAuth response");
    if (g || m || h)
      window.history.replaceState({}, "", "/dashboard/integrations");
  }, []);

  async function disconnect(kind: "calendar" | "gmail" | "hubspot") {
    setBusy(kind);
    try {
      const url =
        kind === "calendar"
          ? "/api/integrations/google-calendar"
          : kind === "gmail"
            ? "/api/integrations/gmail"
            : "/api/integrations/hubspot";
      const res = await fetch(url, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success(
        kind === "calendar"
          ? "Calendar disconnected"
          : kind === "gmail"
            ? "Gmail disconnected"
            : "HubSpot disconnected"
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to disconnect");
    } finally {
      setBusy(null);
    }
  }

  async function createKey() {
    setBusy("key");
    try {
      const res = await fetch("/api/lead-capture-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setRawKeyOnce(json.data.rawKey);
      toast.success("Capture key created — copy it now");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to create key");
    } finally {
      setBusy(null);
    }
  }

  async function revokeKey(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/lead-capture-keys?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success("Key revoked");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to revoke");
    } finally {
      setBusy(null);
    }
  }

  async function importHubSpot() {
    setBusy("hs-import");
    try {
      const res = await fetch("/api/integrations/hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      toast.success(
        `${json.data.demo ? "[DEMO] " : ""}Imported ${json.data.imported} · duplicates ${json.data.duplicates}`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect calendar, email, CRM, and lead capture for end-to-end sales engagement."
        actions={<Badge variant="secondary">Phase 8 · Capture + CRM</Badge>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((integration) => {
          const Icon = icons[integration.name] ?? Puzzle;
          const isCalendar = integration.name === "Google Calendar";
          const isGmail = integration.name === "Gmail";
          const isHubSpot = integration.name === "HubSpot";
          const isCapture = integration.name === "Lead Capture API";
          const isWebForms = integration.name === "Web Forms";
          const status = isCalendar
            ? google
            : isGmail
              ? gmail
              : isHubSpot
                ? hubspot
                : null;
          const connected = isCapture
            ? keys.some((k) => k.active)
            : isWebForms
              ? keys.some((k) => k.active)
              : Boolean(status?.connected);
          const accountLabel = isCalendar
            ? google?.googleEmail
            : isGmail
              ? gmail?.emailAddress
              : hubspot?.accountLabel;

          return (
            <Card key={integration.id} className="hover:shadow-md">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{integration.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {integration.category}
                    </p>
                  </div>
                </div>
                {statusBadge(
                  connected,
                  status?.demo,
                  isHubSpot ? hubspot?.lastSyncError : null
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {integration.description}
                </p>
                {connected && accountLabel ? (
                  <p className="text-xs text-muted-foreground">
                    Account: {accountLabel}
                    {status?.demo ? " (demo)" : ""}
                  </p>
                ) : null}
                {(isCalendar || isGmail || isHubSpot) &&
                !connected &&
                status?.demo ? (
                  <p className="text-xs text-muted-foreground">
                    Demo mode — Connect stores a local demo connection.
                  </p>
                ) : null}

                {isCalendar || isGmail || isHubSpot ? (
                  connected ? (
                    <div className="flex flex-wrap gap-2">
                      {isHubSpot ? (
                        <Button
                          variant="secondary"
                          disabled={busy !== null}
                          onClick={() => void importHubSpot()}
                        >
                          Import contacts
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          void disconnect(
                            isCalendar
                              ? "calendar"
                              : isGmail
                                ? "gmail"
                                : "hubspot"
                          )
                        }
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button asChild disabled={status?.configured === false}>
                      <a
                        href={
                          isCalendar
                            ? "/api/integrations/google-calendar/connect"
                            : isGmail
                              ? "/api/integrations/gmail/connect"
                              : "/api/integrations/hubspot/connect"
                        }
                      >
                        Connect
                      </a>
                    </Button>
                  )
                ) : null}

                {isCapture ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Key name"
                      />
                      <Button
                        disabled={busy !== null}
                        onClick={() => void createKey()}
                      >
                        Create
                      </Button>
                    </div>
                    {rawKeyOnce ? (
                      <div className="rounded-md border bg-muted/40 p-2 text-xs break-all">
                        <p className="mb-1 font-medium text-foreground">
                          Copy now — shown once
                        </p>
                        {rawKeyOnce}
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      {keys.slice(0, 5).map((k) => (
                        <div
                          key={k.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span>
                            {k.name} · {k.keyPrefix}…
                            {!k.active ? " (revoked)" : ""}
                          </span>
                          {k.active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void revokeKey(k.id)}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <Button variant="outline" asChild>
                      <Link href="/docs/lead-capture">View docs</Link>
                    </Button>
                  </div>
                ) : null}

                {isWebForms ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Hosted form:{" "}
                      <code>/embed/form?key=YOUR_KEY</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Script: <code>/embed/leadpilot.js</code>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" asChild>
                        <Link href="/docs/lead-capture">View docs</Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/dashboard/leads/import">CSV import</Link>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
