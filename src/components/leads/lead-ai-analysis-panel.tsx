"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatAnalysisProviderLabel,
  formatBuyingStage,
  isLiveAnalysisSource,
  type AIAnalysisStatus,
  type LeadAnalysisSource,
} from "@/types/ai";

export type LeadAnalysisView = {
  score: number;
  intent: string | null;
  urgency: string | null;
  estimatedBudget: string | null;
  industry: string | null;
  buyingStage: string | null;
  requirements: string[];
  painPoints: string[];
  objections: string[];
  recommendation: string | null;
  reasoning: string | null;
  source: LeadAnalysisSource | string;
  updatedAt?: string | null;
};

type LeadAiAnalysisPanelProps = {
  leadId: string;
  initialAnalysis: LeadAnalysisView | null;
  fallbackScore: number;
  fallbackIntent: string | null;
  fallbackUrgency: string | null;
  fallbackBudget: string | null;
};

export function LeadAiAnalysisPanel({
  leadId,
  initialAnalysis,
  fallbackScore,
  fallbackIntent,
  fallbackUrgency,
  fallbackBudget,
}: LeadAiAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<LeadAnalysisView | null>(
    initialAnalysis
  );
  const [status, setStatus] = useState<AIAnalysisStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const score = analysis?.score ?? fallbackScore;
  const intent = analysis?.intent ?? fallbackIntent ?? "—";
  const urgency = analysis?.urgency ?? fallbackUrgency ?? "—";
  const budget =
    analysis?.estimatedBudget ?? fallbackBudget ?? "unknown";
  const isLive = isLiveAnalysisSource(analysis?.source);
  const analyzing = status === "analyzing";

  async function handleAnalyze() {
    if (analyzing) return;
    setStatus("analyzing");
    setError(null);

    try {
      const res = await fetch("/api/ai/analyze-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error || "Unable to analyze this lead right now. Please try again."
        );
      }

      setAnalysis({
        score: json.data.analysis.score,
        intent: json.data.analysis.intent,
        urgency: json.data.analysis.urgency,
        estimatedBudget: json.data.analysis.estimatedBudget,
        industry: json.data.analysis.industry,
        buyingStage: json.data.analysis.buyingStage,
        requirements: json.data.analysis.requirements ?? [],
        painPoints: json.data.analysis.painPoints ?? [],
        objections: json.data.analysis.objections ?? [],
        recommendation: json.data.analysis.recommendation,
        reasoning: json.data.analysis.reasoning,
        source: json.data.analysis.source,
        updatedAt: json.data.analysis.updatedAt,
      });
      setStatus("success");
      toast.success(`AI assigned a score of ${json.data.analysis.score}.`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to analyze this lead right now. Please try again.";
      setError(message);
      setStatus("error");
      toast.error(message);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle>AI Lead Score</CardTitle>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isLive
                ? "Live AI analysis stored in your workspace"
                : analysis
                  ? "Seeded demo analysis — not generated live"
                  : "No analysis yet — run Analyze with AI"}
            </p>
          </div>
          <Button
            size="sm"
            onClick={handleAnalyze}
            disabled={analyzing}
            aria-busy={analyzing}
          >
            {analyzing ? "Analyzing…" : "Analyze with AI"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl bg-primary/5 p-4 text-center">
          <p className="text-3xl font-semibold tabular-nums text-foreground">
            {score}
            <span className="text-base font-medium text-muted-foreground">
              {" "}
              / 100
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Overall fit score</p>
        </div>

        <MetricRow label="Intent" value={intent} />
        <MetricRow label="Urgency" value={urgency} />
        <MetricRow label="Estimated budget" value={budget} />
        <MetricRow
          label="Buying stage"
          value={formatBuyingStage(analysis?.buyingStage)}
        />

        <ListBlock title="Requirements" items={analysis?.requirements ?? []} />
        <ListBlock title="Pain points" items={analysis?.painPoints ?? []} />
        {(analysis?.objections?.length ?? 0) > 0 ? (
          <ListBlock title="Objections" items={analysis?.objections ?? []} />
        ) : null}

        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AI recommendation
          </p>
          <p className="mt-1.5 text-sm font-medium text-foreground">
            {analysis?.recommendation ??
              "Run Analyze with AI to generate a recommendation."}
          </p>
        </div>

        {analysis?.reasoning ? (
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              AI reasoning
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {analysis.reasoning}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Badge
          variant={isLive ? "success" : "secondary"}
          className="w-full justify-center py-1.5"
        >
          {analysis
            ? formatAnalysisProviderLabel(analysis.source)
            : "Awaiting first analysis"}
        </Badge>
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold capitalize text-foreground">
        {value}
      </span>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">None identified</p>
      ) : (
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
