"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Copy, MessageSquareText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import {
  CHANNEL_LABELS,
  RESPONSE_TYPE_LABELS,
  TONE_LABELS,
  type SalesResponseChannel,
  type SalesResponseTone,
  type SalesResponseType,
} from "@/types/sales-response";

export type GeneratedResponseView = {
  id: string;
  leadId: string;
  channel: SalesResponseChannel;
  responseType: SalesResponseType;
  tone: SalesResponseTone;
  subject: string | null;
  body: string;
  callToAction: string;
  personalizationNotes: string[];
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

type LeadAiResponsePanelProps = {
  leadId: string;
  hasAnalysis: boolean;
  initialResponses: GeneratedResponseView[];
};

type PanelStatus = "idle" | "generating" | "saving" | "deleting";

const RESPONSE_TYPES = Object.keys(RESPONSE_TYPE_LABELS) as SalesResponseType[];
const TONES = Object.keys(TONE_LABELS) as SalesResponseTone[];
const CHANNELS = Object.keys(CHANNEL_LABELS) as SalesResponseChannel[];

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "flex min-h-[140px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

export function LeadAiResponsePanel({
  leadId,
  hasAnalysis,
  initialResponses,
}: LeadAiResponsePanelProps) {
  const [responseType, setResponseType] =
    useState<SalesResponseType>("initial_outreach");
  const [tone, setTone] = useState<SalesResponseTone>("professional");
  const [channel, setChannel] = useState<SalesResponseChannel>("email");
  const [history, setHistory] =
    useState<GeneratedResponseView[]>(initialResponses);
  const [activeId, setActiveId] = useState<string | null>(
    initialResponses[0]?.id ?? null
  );
  const [subject, setSubject] = useState(initialResponses[0]?.subject ?? "");
  const [body, setBody] = useState(initialResponses[0]?.body ?? "");
  const [callToAction, setCallToAction] = useState(
    initialResponses[0]?.callToAction ?? ""
  );
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);

  const active = useMemo(
    () => history.find((item) => item.id === activeId) ?? null,
    [history, activeId]
  );

  const busy = status !== "idle";

  function loadIntoEditor(item: GeneratedResponseView) {
    setActiveId(item.id);
    setSubject(item.subject ?? "");
    setBody(item.body);
    setCallToAction(item.callToAction);
    setResponseType(item.responseType);
    setTone(item.tone);
    setChannel(item.channel);
    setDirty(false);
    setCopied(false);
    setError(null);
  }

  async function handleGenerate() {
    if (busy) return;
    if (!hasAnalysis && history.length === 0) {
      const message =
        "Analyze this lead with AI before generating a sales response.";
      setError(message);
      toast.error(message);
      return;
    }

    setStatus("generating");
    setError(null);
    setCopied(false);

    try {
      const res = await fetch("/api/ai/generate-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, responseType, tone, channel }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(
          json.error ||
            "Unable to generate a sales response right now. Please try again."
        );
      }

      const created = json.response as GeneratedResponseView;
      setHistory((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
      loadIntoEditor(created);
      setStatus("idle");
      toast.success("Personalized sales response generated.");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to generate a sales response right now. Please try again.";
      setError(message);
      setStatus("idle");
      toast.error(message);
    }
  }

  async function handleSave() {
    if (!active || busy || !dirty) return;
    setStatus("saving");
    setError(null);

    try {
      const res = await fetch(`/api/ai/generated-responses/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: channel === "email" ? subject : null,
          body,
          callToAction,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to save changes.");
      }

      const updated = json.response as GeneratedResponseView;
      setHistory((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      loadIntoEditor(updated);
      setStatus("idle");
      toast.success("Response saved.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to save changes.";
      setError(message);
      setStatus("idle");
      toast.error(message);
    }
  }

  async function handleDelete(id: string) {
    if (busy) return;
    if (!window.confirm("Delete this generated response?")) return;

    setStatus("deleting");
    setError(null);

    try {
      const res = await fetch(`/api/ai/generated-responses/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to delete this response.");
      }

      const next = history.filter((item) => item.id !== id);
      setHistory(next);
      if (activeId === id) {
        if (next[0]) loadIntoEditor(next[0]);
        else {
          setActiveId(null);
          setSubject("");
          setBody("");
          setCallToAction("");
          setDirty(false);
        }
      }
      setStatus("idle");
      toast.success("Response deleted.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to delete this response.";
      setError(message);
      setStatus("idle");
      toast.error(message);
    }
  }

  async function handleCopy() {
    if (!body.trim()) return;
    const text =
      channel === "email"
        ? `Subject: ${subject.trim()}\n\n${body.trim()}`
        : body.trim();

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Unable to copy to clipboard.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-primary" />
              <CardTitle>AI Sales Response</CardTitle>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a personalized draft — nothing is sent automatically
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAnalysis ? (
          <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Run <span className="font-medium text-foreground">Analyze with AI</span>{" "}
            first so the response can use lead intelligence context.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Response type">
            <select
              className={selectClassName}
              value={responseType}
              disabled={busy}
              onChange={(e) =>
                setResponseType(e.target.value as SalesResponseType)
              }
            >
              {RESPONSE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {RESPONSE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tone">
            <select
              className={selectClassName}
              value={tone}
              disabled={busy}
              onChange={(e) => setTone(e.target.value as SalesResponseTone)}
            >
              {TONES.map((value) => (
                <option key={value} value={value}>
                  {TONE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select
              className={selectClassName}
              value={channel}
              disabled={busy}
              onChange={(e) =>
                setChannel(e.target.value as SalesResponseChannel)
              }
            >
              {CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {CHANNEL_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={busy || !hasAnalysis}
          aria-busy={status === "generating"}
        >
          {status === "generating"
            ? "Generating personalized response…"
            : active
              ? "Regenerate"
              : "Generate Response"}
        </Button>

        {active ? (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {RESPONSE_TYPE_LABELS[active.responseType]}
              </Badge>
              <Badge variant="secondary">{CHANNEL_LABELS[active.channel]}</Badge>
              <Badge variant="secondary">{TONE_LABELS[active.tone]}</Badge>
              <Badge variant="outline">
                {active.provider} · {active.model}
              </Badge>
            </div>

            {channel === "email" ? (
              <Field label="Subject">
                <Input
                  value={subject}
                  disabled={busy}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
            ) : null}

            <Field label="Message">
              <textarea
                className={textareaClassName}
                value={body}
                disabled={busy}
                onChange={(e) => {
                  setBody(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>

            <Field label="Call to action">
              <Input
                value={callToAction}
                disabled={busy}
                onChange={(e) => {
                  setCallToAction(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>

            {active.personalizationNotes.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Personalization notes
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                  {active.personalizationNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                disabled={busy || !body.trim()}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={busy || !hasAnalysis}
              >
                Regenerate
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={busy || !dirty}
              >
                {status === "saving" ? "Saving…" : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => handleDelete(active.id)}
                disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Response History
            </h3>
            <p className="text-xs text-muted-foreground">
              Previous drafts are kept — regenerating creates a new record
            </p>
          </div>

          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No generated responses yet.
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((item) => {
                const selected = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => loadIntoEditor(item)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {RESPONSE_TYPE_LABELS[item.responseType]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {CHANNEL_LABELS[item.channel]} · {TONE_LABELS[item.tone]}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.channel === "email" && item.subject
                        ? `${item.subject} — ${item.body}`
                        : item.body}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(item.createdAt)} · {item.provider}/
                      {item.model}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
