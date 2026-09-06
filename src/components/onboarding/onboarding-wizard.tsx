"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  "Workspace",
  "Industry",
  "Timezone",
  "Calendar",
  "Gmail",
  "Leads",
  "Finish",
] as const;

const TIMEZONES = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
  "UTC",
];

type Props = {
  initialCompanyName: string;
  initialIndustry: string;
  initialTimezone: string;
};

export function OnboardingWizard({
  initialCompanyName,
  initialIndustry,
  initialTimezone,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [industry, setIndustry] = useState(initialIndustry || "General");
  const [timezone, setTimezone] = useState(
    initialTimezone && initialTimezone !== "UTC"
      ? initialTimezone
      : typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : "UTC"
  );

  async function savePartial(extra?: { completeOnboarding?: boolean }) {
    const res = await fetch("/api/settings/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName,
        industry,
        timezone,
        ...extra,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Save failed");
  }

  function next() {
    startTransition(async () => {
      try {
        if (step <= 2) await savePartial();
        if (step < STEPS.length - 1) setStep((s) => s + 1);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unable to save");
      }
    });
  }

  function finish() {
    startTransition(async () => {
      try {
        await savePartial({ completeOnboarding: true });
        toast.success("Workspace ready");
        router.replace("/dashboard");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unable to finish");
      }
    });
  }

  function skipIntegrations() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-sm font-bold tracking-[0.14em]">
          LEADPILOT <span className="text-primary">AI</span>
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Set up your workspace
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
      </div>

      <div className="mb-4 flex gap-1">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i <= step ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 ? (
            <div className="space-y-2">
              <Label htmlFor="company">Company / workspace name</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                minLength={2}
              />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. Home services, Healthcare"
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-2">
              <Label htmlFor="tz">Timezone (IANA)</Label>
              <select
                id="tz"
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {[timezone, ...TIMEZONES.filter((t) => t !== timezone)].map(
                  (t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  )
                )}
              </select>
              <p className="text-xs text-muted-foreground">
                Used for appointments and follow-up scheduling.
              </p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Optionally connect Google Calendar for real appointment sync.</p>
              <Button asChild>
                <a href="/api/integrations/google-calendar/connect">
                  Connect Google Calendar
                </a>
              </Button>
              <Button variant="ghost" onClick={skipIntegrations}>
                Skip for now
              </Button>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Optionally connect Gmail for AI email sending.</p>
              <Button asChild>
                <a href="/api/integrations/gmail/connect">Connect Gmail</a>
              </Button>
              <Button variant="ghost" onClick={skipIntegrations}>
                Skip for now
              </Button>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Import leads via CSV or start with a blank pipeline.</p>
              <Button asChild variant="secondary">
                <Link href="/dashboard/leads/import">Import CSV</Link>
              </Button>
              <Button variant="ghost" onClick={skipIntegrations}>
                Skip for now
              </Button>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                You&apos;re ready. Your workspace uses real PostgreSQL
                persistence — no demo company data.
              </p>
              <Button className="w-full" disabled={pending} onClick={finish}>
                {pending ? "Finishing…" : "Go to dashboard"}
              </Button>
            </div>
          ) : null}

          {step <= 2 ? (
            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="outline"
                disabled={step === 0 || pending}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </Button>
              <Button disabled={pending || companyName.trim().length < 2} onClick={next}>
                {pending ? "Saving…" : "Continue"}
              </Button>
            </div>
          ) : null}

          {step >= 3 && step <= 5 ? (
            <div className="flex justify-end">
              <Button variant="outline" onClick={next}>
                Continue
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
