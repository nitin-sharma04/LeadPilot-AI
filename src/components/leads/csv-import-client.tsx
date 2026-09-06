"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

type Preview = {
  headers: string[];
  previewRows: string[][];
  totalRows: number;
};

type ImportResult = {
  id: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  failedRows: number;
  status: string;
  errorSummary?: string | null;
};

type HistoryRow = {
  id: string;
  filename: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  failedRows: number;
  status: string;
  createdAt: string;
};

const FIELDS = [
  { key: "name", label: "Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "companyName", label: "Company", required: false },
  { key: "website", label: "Website", required: false },
  { key: "message", label: "Message", required: false },
] as const;

function guessMapping(headers: string[]) {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...needles: string[]) => {
    const i = lower.findIndex((h) => needles.some((n) => h.includes(n)));
    return i >= 0 ? headers[i] : "";
  };
  return {
    name: find("name", "full name"),
    email: find("email", "e-mail"),
    phone: find("phone", "mobile", "tel"),
    companyName: find("company", "organization"),
    website: find("website", "url", "site"),
    message: find("message", "notes", "comment"),
  };
}

export function CsvImportClient({
  initialHistory,
}: {
  initialHistory: HistoryRow[];
}) {
  const [csvText, setCsvText] = useState("");
  const [filename, setFilename] = useState("leads.csv");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [busy, setBusy] = useState(false);

  const canCommit = useMemo(
    () => Boolean(preview && mapping.name && mapping.email),
    [preview, mapping]
  );

  async function onFile(file: File) {
    const text = await file.text();
    setFilename(file.name);
    setCsvText(text);
    setResult(null);
    setBusy(true);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", csvText: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Preview failed");
      setPreview(json.data);
      setMapping(guessMapping(json.data.headers));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!canCommit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          csvText,
          filename,
          mapping,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      setResult(json.data);
      toast.success(
        `Imported ${json.data.importedRows} · duplicates ${json.data.duplicateRows}`
      );
      const histRes = await fetch("/api/leads/import");
      const histJson = await histRes.json();
      if (histRes.ok) setHistory(histJson.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import leads"
        description="Upload a CSV, map columns, preview, then import into this workspace."
        actions={<Badge variant="secondary">Phase 8</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground hover:bg-muted/40">
            <Upload className="h-5 w-5" />
            <span>Choose a CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>

          {preview ? (
            <>
              <p className="text-sm text-muted-foreground">
                {filename} · {preview.totalRows} rows
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label>
                      {f.label}
                      {f.required ? " *" : ""}
                    </Label>
                    <select
                      className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                      value={mapping[f.key] || ""}
                      onChange={(e) =>
                        setMapping({ ...mapping, [f.key]: e.target.value })
                      }
                    >
                      <option value="">— skip —</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        {row.map((c, j) => (
                          <td key={j} className="px-2 py-1.5 text-muted-foreground">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button disabled={!canCommit || busy} onClick={() => void commit()}>
                {busy ? "Working…" : "Import leads"}
              </Button>
            </>
          ) : null}

          {result ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p>
                Imported <strong>{result.importedRows}</strong> · Duplicates{" "}
                <strong>{result.duplicateRows}</strong> · Failed{" "}
                <strong>{result.failedRows}</strong> / {result.totalRows}
              </p>
              {result.errorSummary ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.errorSummary}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{h.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(h.createdAt).toLocaleString()} · {h.status}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {h.importedRows} imported · {h.duplicateRows} dup ·{" "}
                  {h.failedRows} failed / {h.totalRows}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
