/**
 * Generate Prisma Client into voice-server/node_modules using the monorepo schema.
 * Render rootDir=voice-server: schema lives at ../prisma/schema.prisma (full repo clone).
 * We write a temp schema under voice-server so Prisma resolves output to THIS package's
 * node_modules — without duplicating models in git or creating a second database.
 */
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const voiceServerRoot = path.resolve(__dirname, "..");
const monorepoSchema = path.resolve(voiceServerRoot, "../prisma/schema.prisma");
const tmpSchema = path.join(voiceServerRoot, ".generated.schema.prisma");

if (!existsSync(monorepoSchema)) {
  console.error(
    "[voice-server] Missing Prisma schema at ../prisma/schema.prisma. " +
      "Deploy must include the monorepo prisma/ directory (Render clones the full repo)."
  );
  process.exit(1);
}

const prismaCli = path.join(
  voiceServerRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js"
);

if (!existsSync(prismaCli)) {
  console.error(
    "[voice-server] prisma CLI not found at node_modules/prisma. Run npm install first."
  );
  process.exit(1);
}

try {
  // Same schema content; location under voice-server forces client output into
  // voice-server/node_modules/.prisma/client (not the parent Next.js node_modules).
  writeFileSync(tmpSchema, readFileSync(monorepoSchema, "utf8"), "utf8");

  const result = spawnSync(
    process.execPath,
    [prismaCli, "generate", "--schema", tmpSchema],
    {
      stdio: "inherit",
      cwd: voiceServerRoot,
      env: process.env,
    }
  );

  if (result.error) {
    console.error("[voice-server] prisma generate failed to start", result.error);
    process.exit(1);
  }

  process.exit(result.status === null ? 1 : result.status);
} finally {
  try {
    unlinkSync(tmpSchema);
  } catch {
    /* ignore */
  }
}
