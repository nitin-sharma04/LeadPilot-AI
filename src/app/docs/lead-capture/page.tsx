import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Lead Capture Developer Docs",
};

export default function LeadCaptureDocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <PageHeader
        title="Lead Capture API"
        description="Public capture, webhooks, embed forms, and HubSpot sync for LeadPilot workspaces."
        actions={<Badge variant="secondary">Phase 8</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Capture API keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Create keys from{" "}
            <Link className="text-foreground underline" href="/dashboard/integrations">
              Integrations → Lead Capture API
            </Link>
            . The raw key is shown once. Only a SHA-256 hash is stored.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`Authorization: Bearer lp_live_…`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Public lead capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <code className="text-foreground">POST /api/public/leads</code>
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`curl -X POST "$APP_URL/api/public/leads" \\
  -H "Authorization: Bearer lp_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Alex Rivera",
    "email": "alex@example.com",
    "phone": "+1 555 0100",
    "company": "Rivera Dental",
    "message": "Need online booking",
    "source": "API"
  }'`}</pre>
          <p>
            Clients cannot set <code>companyId</code>, scores, or owners. The key
            maps to exactly one workspace.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Signed webhooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <code className="text-foreground">POST /api/webhooks/leads</code>
          </p>
          <p>
            When <code>LEAD_WEBHOOK_SECRET</code> is set, send HMAC-SHA256 hex of
            the raw body in <code>X-LeadPilot-Signature</code>. Include a unique{" "}
            <code>eventId</code> for replay protection.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`{
  "eventId": "evt_abc123",
  "source": "zapier",
  "timestamp": 1730000000,
  "lead": {
    "name": "Jordan Lee",
    "email": "jordan@example.com",
    "phone": "+1 555 0199",
    "company": "Lee HVAC",
    "message": "Need after-hours coverage"
  }
}`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Embeddable form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">{`<div id="lp-form"></div>
<script src="$APP_URL/embed/leadpilot.js"></script>
<script>
  LeadPilot.init({
    formKey: "lp_live_YOUR_KEY",
    target: "#lp-form",
    apiBase: "$APP_URL"
  });
</script>`}</pre>
          <p>
            Or link to{" "}
            <code className="text-foreground">/embed/form?key=lp_live_…</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>5. HubSpot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Connect from Integrations. OAuth tokens stay server-side. Import
            contacts maps HubSpot contact IDs to{" "}
            <code>LeadExternalIdentity</code>. Live sync requires real{" "}
            <code>HUBSPOT_CLIENT_ID</code> / <code>HUBSPOT_CLIENT_SECRET</code>.
            Demo mode never creates real HubSpot records.
          </p>
          <p className="text-xs">
            Conflict policy: LeadPilot owns AI score/intent/recommendations and
            call summaries. HubSpot owns CRM contact IDs. Shared contact fields
            (name, email, phone, company) are pushed from LeadPilot on update
            when a live connection exists.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
