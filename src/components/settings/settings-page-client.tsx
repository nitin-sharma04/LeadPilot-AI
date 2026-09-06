"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmailSettingsPanel } from "@/components/settings/email-settings-panel";
import { LeadCaptureSettingsPanel } from "@/components/settings/lead-capture-settings-panel";

type SettingsPageClientProps = {
  userName: string;
  userEmail: string;
  userRole: string;
  companyName: string;
};

export function SettingsPageClient({
  userName,
  userEmail,
  userRole,
  companyName,
}: SettingsPageClientProps) {
  const [name, setName] = useState(userName);
  const [company, setCompany] = useState(companyName);
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [timezones, setTimezones] = useState<string[]>(["UTC"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/settings/workspace")
      .then((r) => r.json())
      .then((json) => {
        if (!json.data) return;
        setCompany(json.data.company?.name || companyName);
        setIndustry(json.data.company?.industry || "");
        setWebsite(json.data.company?.website || "");
        setTimezone(json.data.company?.timezone || "UTC");
        setName(json.data.profile?.name || userName);
        setTimezones(json.data.timezones || ["UTC"]);
      })
      .catch(() => undefined);
  }, [companyName, userName]);

  async function saveProfile() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: name,
          companyName: company,
          industry,
          website,
          timezone,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace preferences for company, profile, AI, and security."
      />

      <Tabs defaultValue="company">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ai">AI Settings</TabsTrigger>
          <TabsTrigger value="voice">Voice Agent</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="leads">Lead Capture</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <SettingsCard
            title="Company"
            description="Public company details used across the product."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {[timezone, ...timezones.filter((t) => t !== timezone)].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>
            <Button disabled={saving} onClick={() => void saveProfile()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="profile">
          <SettingsCard
            title="Profile"
            description="Your personal account details for this workspace."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={userEmail} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Input id="role" value={userRole} disabled />
              </div>
            </div>
            <Button disabled={saving} onClick={() => void saveProfile()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="ai">
          <SettingsCard
            title="AI Settings"
            description="Lead capture automation controls live AI behavior for new leads."
          >
            <p className="text-sm text-muted-foreground">
              Configure auto-analyze and related flags under the Lead Capture tab.
              Agent voice scripts are managed on the AI Agent page.
            </p>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="voice">
          <SettingsCard
            title="Voice Agent"
            description="Outbound qualification uses your workspace AI agent and Twilio configuration."
          >
            <p className="text-sm text-muted-foreground">
              Voice credentials are server-side environment variables. Call
              history persists in PostgreSQL.
            </p>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="email">
          <EmailSettingsPanel />
        </TabsContent>

        <TabsContent value="leads">
          <LeadCaptureSettingsPanel />
        </TabsContent>

        <TabsContent value="notifications">
          <SettingsCard
            title="Notifications"
            description="Notifications are stored in PostgreSQL and scoped to your workspace."
          >
            <p className="text-sm text-muted-foreground">
              Use the bell menu to mark notifications read. Preference toggles
              for channels will expand in a later phase.
            </p>
          </SettingsCard>
        </TabsContent>

        <TabsContent value="security">
          <SettingsCard
            title="Security"
            description="Auth.js sessions with bcrypt password hashes."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Session</Label>
                <Input value="JWT (Auth.js)" disabled />
              </div>
              <div className="space-y-2">
                <Label>2FA</Label>
                <Input value="Not enabled yet" disabled />
              </div>
            </div>
          </SettingsCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}
