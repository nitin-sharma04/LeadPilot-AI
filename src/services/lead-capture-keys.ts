/**
 * Lead capture API keys — raw key shown once; only hash stored.
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { hashCaptureKey } from "@/services/leads";
import type { SessionUser } from "@/lib/session";

export async function createCaptureKey(
  user: SessionUser,
  name: string
): Promise<{
  id: string;
  name: string;
  keyPrefix: string;
  /** Raw key — shown once only */
  rawKey: string;
  createdAt: string;
}> {
  const raw = `lp_live_${randomBytes(24).toString("hex")}`;
  const keyHash = hashCaptureKey(raw);
  const keyPrefix = raw.slice(0, 16);

  const row = await prisma.leadCaptureKey.create({
    data: {
      companyId: user.companyId,
      name: name.trim() || "Default capture key",
      keyHash,
      keyPrefix,
      createdById: user.id,
    },
  });

  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    rawKey: raw,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCaptureKeys(user: SessionUser) {
  const rows = await prisma.leadCaptureKey.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    active: !r.revokedAt && (!r.expiresAt || r.expiresAt > new Date()),
  }));
}

export async function revokeCaptureKey(user: SessionUser, id: string) {
  const row = await prisma.leadCaptureKey.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!row) throw new AppError("Key not found", 404);
  await prisma.leadCaptureKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return { revoked: true };
}

/** Rotate = revoke old + create new (raw shown once). */
export async function rotateCaptureKey(
  user: SessionUser,
  id: string,
  name?: string
) {
  const row = await prisma.leadCaptureKey.findFirst({
    where: { id, companyId: user.companyId },
  });
  if (!row) throw new AppError("Key not found", 404);
  await prisma.leadCaptureKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return createCaptureKey(user, name || `${row.name} (rotated)`);
}

export async function resolveCompanyFromCaptureKey(rawKey: string) {
  const keyHash = hashCaptureKey(rawKey.trim());
  const row = await prisma.leadCaptureKey.findUnique({
    where: { keyHash },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;

  await prisma.leadCaptureKey.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });

  return { companyId: row.companyId, keyId: row.id };
}

/** Simple in-memory rate limit (per process). */
const hitMap = new Map<string, { count: number; reset: number }>();

export function checkCaptureRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): boolean {
  const now = Date.now();
  const cur = hitMap.get(key);
  if (!cur || cur.reset < now) {
    hitMap.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}
