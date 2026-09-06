"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Settings = {
  emailAutomationEnabled: boolean;
  emailAutoSendEnabled: boolean;
  emailAppointmentConfirmEnabled: boolean;
  emailFollowUpSequencesEnabled: boolean;
  emailPostCallEnabled: boolean;
  emailHumanApprovalRequired: boolean;
  defaultEmailAccountId: string | null;
};

type Account = {
  id: string;
  emailAddress: string;
  provider: string;
};

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border px-3 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/settings/email");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed");
    setSettings(json.data.settings);
    setAccounts(json.data.accounts || []);
  }

  useEffect(() => {
    void load().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Unable to load settings")
    );
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setSettings(json.data);
      toast.success("Email settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading email settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email automation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Toggle
          label="Email automation master switch"
          description="Required for appointment/post-call automation and scheduled sequences."
          checked={settings.emailAutomationEnabled}
          onChange={(v) =>
            setSettings({ ...settings, emailAutomationEnabled: v })
          }
        />
        <Toggle
          label="Human approval required"
          description="Default ON. AI prepares drafts; user must send manually unless auto-send is enabled."
          checked={settings.emailHumanApprovalRequired}
          onChange={(v) =>
            setSettings({ ...settings, emailHumanApprovalRequired: v })
          }
        />
        <Toggle
          label="Automatic send"
          description="Only sends without approval when this is ON and human approval is OFF."
          checked={settings.emailAutoSendEnabled}
          onChange={(v) =>
            setSettings({ ...settings, emailAutoSendEnabled: v })
          }
        />
        <Toggle
          label="Appointment confirmation emails"
          description="After a real booked appointment, prepare/send confirmation using actual meeting data."
          checked={settings.emailAppointmentConfirmEnabled}
          onChange={(v) =>
            setSettings({ ...settings, emailAppointmentConfirmEnabled: v })
          }
        />
        <Toggle
          label="Post-call emails"
          description="After AI calls complete, prepare a follow-up when no appointment was booked."
          checked={settings.emailPostCallEnabled}
          onChange={(v) =>
            setSettings({ ...settings, emailPostCallEnabled: v })
          }
        />
        <Toggle
          label="Follow-up sequences"
          description="Allow the scheduler to advance nurture enrollments."
          checked={settings.emailFollowUpSequencesEnabled}
          onChange={(v) =>
            setSettings({ ...settings, emailFollowUpSequencesEnabled: v })
          }
        />

        <div className="space-y-2 pt-2">
          <Label htmlFor="default-account">Default sending account</Label>
          <select
            id="default-account"
            className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            value={settings.defaultEmailAccountId || ""}
            onChange={(e) =>
              setSettings({
                ...settings,
                defaultEmailAccountId: e.target.value || null,
              })
            }
          >
            <option value="">First connected account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emailAddress}
                {a.provider === "DEMO" ? " (demo)" : ""}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save email settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
