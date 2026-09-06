import { Bot } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TestAgentButton } from "@/components/ai-agent/test-agent-button";
import { requireSession } from "@/lib/session";
import { getAiAgent } from "@/services/workspace";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Agent",
};

export const dynamic = "force-dynamic";

export default async function AiAgentPage() {
  const user = await requireSession();
  const agent = await getAiAgent(user);

  const name = agent?.name ?? "Alex";
  const voice = agent?.voice ?? "professional-female";
  const tone = agent?.tone ?? "consultative";
  const greeting =
    agent?.greeting ??
    "Hi, this is Alex calling about your recent inquiry. Do you have a quick minute to chat?";
  const companyInfo =
    agent?.companyInformation ??
    "LeadPilot AI helps businesses capture, score, and convert leads.";
  const questions = agent?.qualificationQuestions?.length
    ? agent.qualificationQuestions
    : [
        "What service are you interested in?",
        "What is your approximate budget?",
        "When would you like to get started?",
        "Are you currently comparing other providers?",
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Sales Agent"
        description="Configure your voice qualification agent. Voice calling connects in a later phase."
        actions={<TestAgentButton />}
      />

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{name}</h2>
                <Badge variant="warning">Demo Mode</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Default AI sales agent for inbound lead qualification
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground sm:max-w-xs sm:text-right">
            Configuration is loaded from PostgreSQL. Live voice is deferred.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Agent configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input id="agent-name" defaultValue={name} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice">Voice</Label>
              <Input id="voice" defaultValue={voice} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone">Tone</Label>
              <Input id="tone" defaultValue={tone} readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="greeting">Greeting</Label>
              <textarea
                id="greeting"
                className="min-h-[96px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                defaultValue={greeting}
                readOnly
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Company & qualification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-info">Company information</Label>
              <textarea
                id="company-info"
                className="min-h-[96px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                defaultValue={companyInfo}
                readOnly
              />
            </div>
            <div>
              <Label>Qualification questions</Label>
              <ul className="mt-3 space-y-2">
                {questions.map((q) => (
                  <li
                    key={q}
                    className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
