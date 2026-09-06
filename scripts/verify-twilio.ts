/**
 * Safe Twilio credential + number verification (no outbound calls).
 * Run: npx tsx scripts/verify-twilio.ts
 *
 * Never prints TWILIO_AUTH_TOKEN or full secrets.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import twilio from "twilio";

const EXPECTED_PHONE = "+13412991349";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // .env.local overrides .env
    process.env[key] = value;
  }
}

function redactError(message: string): string {
  return message
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, "[REDACTED]")
    .replace(/AC[a-fA-F0-9]{32}/g, "AC…[REDACTED]")
    .replace(/AuthToken[=:]?\s*\S+/gi, "AuthToken=[REDACTED]");
}

function fail(message: string): never {
  console.error(`FAIL: ${redactError(message)}`);
  process.exit(1);
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim() || "";

  console.log("Account SID present:", accountSid ? "YES" : "NO");
  console.log("Auth Token present:", authToken ? "YES" : "NO");
  console.log("Phone number present:", phoneNumber ? "YES" : "NO");

  if (!accountSid || !authToken || !phoneNumber) {
    fail(
      "Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER in .env.local"
    );
  }

  if (
    accountSid.includes("xxxx") ||
    authToken === "your_auth_token" ||
    /your_auth/i.test(authToken)
  ) {
    fail(
      "Twilio credentials still look like demo placeholders. Replace them with real values in .env.local."
    );
  }

  if (!/^AC[a-zA-Z0-9]{32}$/.test(accountSid)) {
    fail("TWILIO_ACCOUNT_SID format looks invalid (expected ACxxxxxxxx…).");
  }

  if (phoneNumber !== EXPECTED_PHONE) {
    fail(
      `TWILIO_PHONE_NUMBER mismatch. Expected ${EXPECTED_PHONE}, got a different value.`
    );
  }

  const client = twilio(accountSid, authToken);

  let authPass = false;
  let accountPass = false;
  let numberPass = false;
  let voicePass = false;

  try {
    const account = await client.api.accounts(accountSid).fetch();
    authPass = true;
    accountPass = Boolean(account.sid && account.status);
    console.log("Twilio authentication: PASS");
    console.log("Account accessible: PASS");
    console.log("Account status:", account.status || "unknown");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "authentication failed";
    fail(`Twilio authentication failed: ${msg}`);
  }

  try {
    const numbers = await client.incomingPhoneNumbers.list({
      phoneNumber: EXPECTED_PHONE,
      limit: 5,
    });
    const match = numbers.find((n) => n.phoneNumber === EXPECTED_PHONE);
    if (!match) {
      fail(
        `Configured number ${EXPECTED_PHONE} was not found on this Twilio account.`
      );
    }
    numberPass = true;
    const voiceCapable = Boolean(match.capabilities?.voice);
    voicePass = voiceCapable;
    console.log("Configured number: PASS");
    console.log("Friendly name:", match.friendlyName || "(none)");
    console.log("Voice capability:", voiceCapable ? "PASS" : "FAIL");
    if (!voiceCapable) {
      fail(`Number ${EXPECTED_PHONE} does not have Voice capability enabled.`);
    }
  } catch (error) {
    if (!numberPass) {
      const msg =
        error instanceof Error ? error.message : "number lookup failed";
      fail(`Phone number verification failed: ${msg}`);
    }
    throw error;
  }

  if (!(authPass && accountPass && numberPass && voicePass)) {
    fail("One or more Twilio checks failed.");
  }

  console.log("Twilio credential verification: ALL CHECKS PASSED");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : "unexpected failure";
  fail(msg);
});
