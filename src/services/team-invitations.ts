/**
 * Team invitations — token hashed, expiring, one-time use.
 * Email delivery uses a safe fallback log when no mailer is configured.
 */

import { createHash, randomBytes } from "crypto";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { appPath } from "@/lib/app-url";
import { requireOwnerOrAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createTeamInvitation(
  user: SessionUser,
  input: { email: string; role?: UserRole }
) {
  requireOwnerOrAdmin(user);

  const email = input.email.toLowerCase().trim();
  const role = input.role ?? UserRole.SALES_REP;
  if (role === UserRole.OWNER) {
    throw new AppError("Cannot invite another OWNER via invitation", 400);
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser?.companyId === user.companyId) {
    throw new AppError("User is already in this workspace", 409);
  }
  if (existingUser && existingUser.companyId !== user.companyId) {
    throw new AppError(
      "This email belongs to another workspace. Contact support to migrate.",
      409
    );
  }

  const rawToken = `inv_${randomBytes(24).toString("hex")}`;
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Revoke prior open invites for same email in this company
  await prisma.teamInvitation.updateMany({
    where: {
      companyId: user.companyId,
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const invite = await prisma.teamInvitation.create({
    data: {
      companyId: user.companyId,
      email,
      role,
      tokenHash,
      invitedById: user.id,
      expiresAt,
    },
  });

  const acceptUrl = appPath(`/invite/accept?token=${rawToken}`);

  // Safe development fallback — never claim email was sent unless mailer exists
  const emailConfigured = Boolean(process.env.INVITE_EMAIL_FROM?.trim());
  if (emailConfigured) {
    // Hook for future transactional email provider
    console.info("[invite] email dispatch pending provider", {
      invitationId: invite.id,
      companyId: user.companyId,
    });
  } else {
    console.info("[invite] development fallback — share accept URL manually", {
      invitationId: invite.id,
      email,
      acceptUrl,
    });
  }

  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    /** Raw token / URL only returned once to the inviter (not stored). */
    acceptUrl: emailConfigured ? null : acceptUrl,
    emailSent: false,
    message: emailConfigured
      ? "Invitation created. Email provider integration pending."
      : "Invitation created. Share the accept link (shown once) — email sending is not configured.",
  };
}

export async function listTeamInvitations(user: SessionUser) {
  requireOwnerOrAdmin(user);
  const rows = await prisma.teamInvitation.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    status: r.acceptedAt
      ? "accepted"
      : r.revokedAt
        ? "revoked"
        : r.expiresAt < new Date()
          ? "expired"
          : "pending",
  }));
}

export async function acceptTeamInvitation(input: {
  token: string;
  name: string;
  password: string;
}) {
  const tokenHash = hashToken(input.token.trim());
  const invite = await prisma.teamInvitation.findUnique({
    where: { tokenHash },
    include: { company: true },
  });

  if (!invite || invite.revokedAt) {
    throw new AppError("Invitation is invalid or revoked", 400);
  }
  if (invite.acceptedAt) {
    throw new AppError("Invitation was already used", 400);
  }
  if (invite.expiresAt < new Date()) {
    throw new AppError("Invitation has expired", 400);
  }

  const email = invite.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("An account with this email already exists", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId: invite.companyId,
        email,
        name: input.name.trim(),
        passwordHash,
        role: invite.role,
      },
    });
    await tx.teamInvitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
    return created;
  });

  return {
    userId: user.id,
    email: user.email,
    companyId: user.companyId,
    companyName: invite.company.name,
  };
}

/** Password reset architecture — tokens hashed; email delivery optional. */
export async function createPasswordResetToken(emailRaw: string) {
  const email = emailRaw.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  // Always return generic success to avoid account enumeration
  if (!user) {
    return {
      ok: true,
      message: "If an account exists, reset instructions were prepared.",
    };
  }

  const raw = `rst_${randomBytes(24).toString("hex")}`;
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      companyId: user.companyId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const resetUrl = appPath(`/reset-password?token=${raw}`);
  console.info("[password-reset] token created (not emailed unless mailer configured)", {
    userId: user.id,
    resetUrl: process.env.NODE_ENV === "production" ? "[redacted]" : resetUrl,
  });

  return {
    ok: true,
    message: "If an account exists, reset instructions were prepared.",
    ...(process.env.NODE_ENV !== "production" ? { resetUrl } : {}),
  };
}

export async function consumePasswordResetToken(input: {
  token: string;
  password: string;
}) {
  const tokenHash = hashToken(input.token.trim());
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError("Reset link is invalid or expired", 400);
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return { ok: true };
}
