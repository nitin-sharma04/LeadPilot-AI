import { requireSession } from "@/lib/session";
import { listLeadImports } from "@/services/csv-import";
import { CsvImportClient } from "@/components/leads/csv-import-client";

export const dynamic = "force-dynamic";

export default async function LeadsImportPage() {
  const user = await requireSession();
  const history = await listLeadImports(user);
  return <CsvImportClient initialHistory={history} />;
}
