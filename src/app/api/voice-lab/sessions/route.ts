import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isVoiceLabEnabled } from "../../../../../voice-lab/config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isVoiceLabEnabled()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const dir = path.join(process.cwd(), "voice-lab", "sessions");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}.json`);
  await writeFile(file, JSON.stringify(body, null, 2), "utf8");
  return NextResponse.json({ ok: true, file: path.basename(file) });
}
