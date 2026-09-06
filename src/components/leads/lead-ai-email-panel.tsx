"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Mail, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";

type EmailAccount = {
  id: string;
  emailAddress: string;
  displayName: string | null;
  provider: string;
  status: string;
};

type EmailRow = {
  id: string;
  subject: string;
  body: string;
  to: string;
  status: string;
  direction: string;
  isDemo: boolean;
  sentAt: string | null;
  createdAt: string;
  errorMessage: string | null;
};

const EMAIL_TYPES = [
  { value: "intro", label: "Intro" },
  { value: "follow_up", label: "Follow-up" },
  { value: "post_call", label: "Post-call" },
  { value: "appointment_confirmation", label: "Appointment confirmation" },
  { value: "appointment_reminder", label: "Appointment reminder" },
  { value: "re_engagement", label: "Re-engagement" },
] as const;

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Concise" },
  { value: "consultative", label: "Consultative" },
] as const;

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "flex min-h-[140px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

type Props = {
  leadId: string;
  leadEmail: string;
  emailOptOut?: boolean;
};

export function LeadAiEmailPanel({ leadId, leadEmail, emailOptOut }: Props) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [emailType, setEmailType] = useState<string>("follow_up");
  const [tone, setTone] = useState<string>("professional");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cta, setCta] = useState("");
  const [history, setHistory] = useState<EmailRow[]>([]);
  const [busy, setBusy] = useState<"idle" | "generate" | "send" | "draft">(
    "idle"
  );
  const [humanApproval, setHumanApproval] = useState(true);

  const canSend = useMemo(
    () => Boolean(accountId && subject && body && !emailOptOut),
    [accountId, subject, body, emailOptOut]
  );

  async function load() {
    const [settingsRes, emailsRes] = await Promise.all([
      fetch("/api/settings/email"),
      fetch(`/api/emails?leadId=${leadId}`),
    ]);
    const settingsJson = await settingsRes.json();
    const emailsJson = await emailsRes.json();
    if (settingsRes.ok) {
      setAccounts(settingsJson.data?.accounts || []);
      setHumanApproval(
        settingsJson.data?.settings?.emailHumanApprovalRequired !== false
      );
      const first = settingsJson.data?.accounts?.[0];
      if (first) setAccountId(first.id);
    }
    if (emailsRes.ok) setHistory(emailsJson.data || []);
  }

  useEffect(() => {
    void load();
  }, [leadId]);

  async function generate() {
    setBusy("generate");
    try {
      const res = await fetch("/api/ai/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, emailType, tone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generate failed");
      setSubject(json.data.result.subject);
      setBody(json.data.result.body);
      setCta(json.data.result.callToAction);
      toast.success("Email draft generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to generate");
    } finally {
      setBusy("idle");
    }
  }

  async function send(asDraft: boolean) {
    if (!canSend) return;
    setBusy(asDraft ? "draft" : "send");
    try {
      const fullBody = cta ? `${body}\n\n${cta}` : body;
      const res = await fetch("/api/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          emailAccountId: accountId,
          subject,
          body: fullBody,
          to: leadEmail,
          asDraft,
          emailType: emailType.toUpperCase(),
          tone: tone.toUpperCase(),
          idempotencyKey: asDraft
            ? undefined
            : `manual:${leadId}:${Date.now()}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Send failed");
      toast.success(
        asDraft
          ? "Draft saved"
          : json.data?.message?.isDemo
            ? "Demo email recorded (not real Gmail)"
            : "Email sent"
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to send");
    } finally {
      setBusy("idle");
    }
  }

  async function copyAll() {
    await navigator.clipboard.writeText(
      `Subject: ${subject}\n\n${body}${cta ? `\n\n${cta}` : ""}`
    );
    toast.success("Copied");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          AI Email Composer
        </CardTitle>
        <div className="flex items-center gap-2">
          {emailOptOut ? (
            <Badge variant="danger">Email Opt-Out</Badge>
          ) : null}
          <Badge variant="secondary">
            {humanApproval ? "Human approval ON" : "Auto-send allowed"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!accounts.length ? (
          <p className="text-sm text-muted-foreground">
            Connect Gmail on Integrations to send. You can still generate drafts.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Email type</Label>
            <select
              className={selectClassName}
              value={emailType}
              onChange={(e) => setEmailType(e.target.value)}
            >
              {EMAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tone</Label>
            <select
              className={selectClassName}
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>From account</Label>
            <select
              className={selectClassName}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={!accounts.length}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emailAddress}
                  {a.provider === "DEMO" ? " (demo)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Recipient</Label>
          <Input value={leadEmail} disabled />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== "idle"}
          >
            {busy === "generate" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Generate
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void send(true)}
            disabled={!canSend || busy !== "idle"}
          >
            Save draft
          </Button>
          <Button
            type="button"
            onClick={() => void send(false)}
            disabled={!canSend || busy !== "idle" || !accounts.length}
          >
            {busy === "send" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Send
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyAll()}
            disabled={!subject && !body}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Body</Label>
          <textarea
            className={textareaClassName}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Email body"
          />
        </div>
        <div className="space-y-1.5">
          <Label>CTA</Label>
          <Input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="Call to action"
          />
        </div>

        <div className="space-y-2 border-t pt-4">
          <h4 className="text-sm font-medium">Email history</h4>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No emails yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{row.direction}</Badge>
                    <Badge
                      variant={
                        row.status === "SENT"
                          ? "info"
                          : row.status === "FAILED"
                            ? "danger"
                            : "secondary"
                      }
                    >
                      {row.status}
                    </Badge>
                    {row.isDemo ? <Badge variant="outline">DEMO</Badge> : null}
                    <span className="font-medium">{row.subject}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.to} · {formatDate(row.sentAt || row.createdAt)}
                    {row.errorMessage ? ` · ${row.errorMessage}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
