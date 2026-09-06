/**
 * Gmail API helpers — server-side only. Never log tokens.
 */

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { getGmailOAuthConfig, isGmailDemoMode } from "./gmail-config";

export async function exchangeGmailCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getGmailOAuthConfig();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new AppError(
      "Google did not return refresh credentials. Reconnect and grant offline access.",
      400
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email;
  if (!email) throw new AppError("Unable to read Google account email.", 400);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: new Date(tokens.expiry_date || Date.now() + 3600_000),
    scope: tokens.scope || "",
    emailAddress: email,
    displayName: me.data.name || null,
  };
}

async function getAuthedGmailClient(accountId: string, companyId: string) {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, companyId },
  });
  if (!account) throw new AppError("Email account not found", 404);
  if (
    account.status === "DISCONNECTED" ||
    account.status === "ERROR"
  ) {
    throw new AppError("Gmail account is not connected.", 400);
  }

  const isDemo =
    account.provider === "DEMO" ||
    account.status === "DEMO" ||
    account.accessToken.startsWith("demo-") ||
    isGmailDemoMode();

  if (isDemo) {
    return { client: null, account, isDemo: true as const };
  }

  const { clientId, clientSecret, redirectUri } = getGmailOAuthConfig();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.tokenExpiry.getTime(),
  });

  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await prisma.emailAccount.update({
      where: { id: account.id },
      data: {
        accessToken: tokens.access_token,
        tokenExpiry: new Date(tokens.expiry_date || Date.now() + 3600_000),
        ...(tokens.refresh_token
          ? { refreshToken: tokens.refresh_token }
          : {}),
      },
    });
  });

  return { client, account, isDemo: false as const };
}

function buildRawMime(input: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  threadId?: string | null;
}): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.bodyText,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(input: {
  accountId: string;
  companyId: string;
  to: string;
  subject: string;
  bodyText: string;
  threadId?: string | null;
}): Promise<{
  providerMessageId: string;
  threadId: string;
  isDemo: boolean;
}> {
  const { client, account, isDemo } = await getAuthedGmailClient(
    input.accountId,
    input.companyId
  );

  if (isDemo || !client) {
    const id = `demo-msg-${Date.now()}`;
    return {
      providerMessageId: id,
      threadId: input.threadId || `demo-thread-${Date.now()}`,
      isDemo: true,
    };
  }

  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: buildRawMime({
          from: account.emailAddress,
          to: input.to,
          subject: input.subject,
          bodyText: input.bodyText,
        }),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });
    const providerMessageId = res.data.id;
    const threadId = res.data.threadId;
    if (!providerMessageId || !threadId) {
      throw new AppError("Gmail did not return a message id.", 502);
    }
    return { providerMessageId, threadId, isDemo: false };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[gmail] send failed", {
      accountId: input.accountId,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new AppError(
      "Unable to send email via Gmail. Try reconnecting.",
      502
    );
  }
}

/** List recent inbox threads for reply detection (polling). */
export async function listRecentInboxMessages(input: {
  accountId: string;
  companyId: string;
  maxResults?: number;
}): Promise<
  Array<{
    id: string;
    threadId: string;
    snippet: string;
    from: string;
    subject: string;
    internalDate: number;
  }>
> {
  const { client, isDemo } = await getAuthedGmailClient(
    input.accountId,
    input.companyId
  );
  if (isDemo || !client) return [];

  const gmail = google.gmail({ version: "v1", auth: client });
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:inbox newer_than:14d",
    maxResults: input.maxResults ?? 25,
  });
  const ids = list.data.messages || [];
  const out: Array<{
    id: string;
    threadId: string;
    snippet: string;
    from: string;
    subject: string;
    internalDate: number;
  }> = [];

  for (const row of ids) {
    if (!row.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: row.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });
    const headers = full.data.payload?.headers || [];
    const get = (n: string) =>
      headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ||
      "";
    out.push({
      id: full.data.id || row.id,
      threadId: full.data.threadId || "",
      snippet: full.data.snippet || "",
      from: get("From"),
      subject: get("Subject"),
      internalDate: Number(full.data.internalDate || 0),
    });
  }
  return out;
}
