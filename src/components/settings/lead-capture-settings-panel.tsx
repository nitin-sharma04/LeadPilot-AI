"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Settings = {
  leadAutoAnalyzeEnabled: boolean;
  leadAutoAssignEnabled: boolean;
  leadAutoFollowUpEnabled: boolean;
  leadAutoCallEnabled: boolean;
  leadAutoEmailEnabled: boolean;
  defaultLeadOwnerId: string | null;
  defaultFollowUpSequenceId: string | null;
};

type Owner = { id: string; name: string };
type Sequence = { id: string; name: string };

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

export function LeadCaptureSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/settings/lead-capture");
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed");
    setSettings(json.data.settings);
    setOwners(json.data.owners || []);
    setSequences(json.data.sequences || []);
  }

  useEffect(() => {
    void load().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Unable to load settings")
    );
  }, []);

  const ownerOptions = useMemo(() => owners, [owners]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/lead-capture", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSettings(json.data);
      toast.success("Lead capture settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Loading lead capture settings…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New lead automation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Toggle
          label="Auto-analyze new leads"
          description="Run AI Lead Intelligence when leads arrive (default ON)."
          checked={settings.leadAutoAnalyzeEnabled}
          onChange={(v) =>
            setSettings({ ...settings, leadAutoAnalyzeEnabled: v })
          }
        />
        <Toggle
          label="Auto-assign new leads"
          description="Assign to the default lead owner when set."
          checked={settings.leadAutoAssignEnabled}
          onChange={(v) =>
            setSettings({ ...settings, leadAutoAssignEnabled: v })
          }
        />
        <Toggle
          label="Auto-start follow-up"
          description="Enroll in the default follow-up sequence (default OFF)."
          checked={settings.leadAutoFollowUpEnabled}
          onChange={(v) =>
            setSettings({ ...settings, leadAutoFollowUpEnabled: v })
          }
        />
        <Toggle
          label="Auto-call high-intent leads"
          description="Reserved — remains OFF unless you enable it (no blind dialing)."
          checked={settings.leadAutoCallEnabled}
          onChange={(v) =>
            setSettings({ ...settings, leadAutoCallEnabled: v })
          }
        />
        <Toggle
          label="Auto-email new leads"
          description="Default OFF. Still respects Gmail human-approval settings."
          checked={settings.leadAutoEmailEnabled}
          onChange={(v) =>
            setSettings({ ...settings, leadAutoEmailEnabled: v })
          }
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="default-owner">Default lead owner</Label>
            <select
              id="default-owner"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              value={settings.defaultLeadOwnerId || ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultLeadOwnerId: e.target.value || null,
                })
              }
            >
              <option value="">Unassigned</option>
              {ownerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-seq">Default follow-up sequence</Label>
            <select
              id="default-seq"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              value={settings.defaultFollowUpSequenceId || ""}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultFollowUpSequenceId: e.target.value || null,
                })
              }
            >
              <option value="">Workspace default</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
