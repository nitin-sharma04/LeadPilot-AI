import { requireSession } from "@/lib/session";
import { jsonError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isGmailConfigured, isGmailDemoMode } from "@/lib/email/gmail-config";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireSession();
    const account = await prisma.emailAccount.findFirst({
      where: {
        companyId: user.companyId,
        userId: user.id,
        status: { in: ["CONNECTED", "DEMO"] },
      },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        status: true,
        provider: true,
        createdAt: true,
      },
    });

    return Response.json({
      data: {
        configured: isGmailConfigured(),
        connected: Boolean(account),
        demo: isGmailDemoMode() || account?.provider === "DEMO",
        emailAddress: account?.emailAddress ?? null,
        displayName: account?.displayName ?? null,
        accountId: account?.id ?? null,
      },
    });
  } catch (error) {
    return jsonError(error, "Unable to load Gmail status", 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireSession();
    await prisma.emailAccount.deleteMany({
      where: { companyId: user.companyId, userId: user.id },
    });
    return Response.json({ data: { disconnected: true } });
  } catch (error) {
    return jsonError(error, "Unable to disconnect Gmail", 500);
  }
}
