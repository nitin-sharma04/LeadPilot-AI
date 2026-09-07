/**
 * Ensure Prisma client is generated for the voice-server deploy.
 * Prefers monorepo schema at ../prisma/schema.prisma when present.
 */
const { existsSync } = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const schemaCandidates = [
  path.resolve(__dirname, "../../prisma/schema.prisma"),
  path.resolve(__dirname, "../prisma/schema.prisma"),
];

const schema = schemaCandidates.find((p) => existsSync(p));
if (!schema) {
  console.warn(
    "[voice-server] prisma schema not found at repo root; skipping generate"
  );
  process.exit(0);
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "generate", "--schema", schema],
  { stdio: "inherit", cwd: path.resolve(__dirname, "..") }
);

process.exit(result.status === null ? 1 : result.status);
