import http from "http";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { prisma } from "./db.js";
import { handleTwilioMediaStream } from "./twilio-stream-handler.js";
import { getLiveModel, resolveGeminiLiveVoice } from "./config.js";
import { resolveVoiceTtsProvider } from "./tts/tts-provider.js";
import { loadDeepgramTtsConfig } from "./tts/deepgram-tts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load repo-root env files when present (local). Render injects env vars directly.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({
  path: path.resolve(__dirname, "../../.env.local"),
  override: true,
});

const PORT = Number(process.env.PORT || process.env.VOICE_SERVER_PORT || 8081);
const HOST = process.env.VOICE_SERVER_HOST || "0.0.0.0";
const startedAt = Date.now();

function healthPayload() {
  const geminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const twilioOk = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim()
  );
  const appUrl = Boolean(
    process.env.APP_URL?.trim() ||
      process.env.VOICE_APP_URL?.trim() ||
      process.env.AUTH_URL?.trim()
  );
  const ready = geminiKey && twilioOk;
  return {
    ok: ready,
    status: ready ? "ok" : "degraded",
    service: "leadpilot-voice-server",
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    websocketPath: "/media-stream",
    host: HOST,
    port: PORT,
    geminiConfigured: geminiKey,
    geminiLiveModel: getLiveModel(),
    geminiLiveVoice: resolveGeminiLiveVoice(),
    ttsProvider: resolveVoiceTtsProvider(),
    deepgramConfigured: Boolean(loadDeepgramTtsConfig()),
    twilioConfigured: twilioOk,
    appUrlConfigured: appUrl,
    environment: process.env.NODE_ENV || "development",
  };
}

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] || "";
  if (url === "/health" || url === "/") {
    const body = healthPayload();
    res.writeHead(body.ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/media-stream" });
let activeStreams = 0;

wss.on("connection", (ws, req) => {
  activeStreams += 1;
  console.info("[voice-server] twilio media stream connected", {
    remote: req.socket.remoteAddress,
    activeStreams,
  });
  ws.on("close", () => {
    activeStreams = Math.max(0, activeStreams - 1);
  });
  void handleTwilioMediaStream(ws);
});

server.listen(PORT, HOST, () => {
  console.info(`[voice-server] listening on ${HOST}:${PORT}`);
  console.info(`[voice-server] media stream path: /media-stream`);
  console.info(`[voice-server] health: http://${HOST}:${PORT}/health`);
  console.info(
    "[voice-server] set VOICE_STREAM_URL on the Next.js service to wss://<this-host>/media-stream"
  );
});

async function shutdown() {
  console.info("[voice-server] shutting down", { activeStreams });
  wss.close();
  server.close();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
