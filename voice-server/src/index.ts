import http from "http";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { prisma } from "./db.js";
import { handleTwilioMediaStream } from "./twilio-stream-handler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load repo-root env files (shared with Next.js)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.local"), override: true });

const PORT = Number(process.env.PORT || process.env.VOICE_SERVER_PORT || 8081);
const HOST = process.env.VOICE_SERVER_HOST || "0.0.0.0";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "leadpilot-voice-server",
        host: HOST,
        port: PORT,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/media-stream" });

wss.on("connection", (ws, req) => {
  console.info("[voice-server] twilio media stream connected", {
    remote: req.socket.remoteAddress,
  });
  void handleTwilioMediaStream(ws);
});

server.listen(PORT, HOST, () => {
  console.info(`[voice-server] listening on ${HOST}:${PORT}`);
  console.info(`[voice-server] media stream path: /media-stream`);
  console.info(
    "[voice-server] set VOICE_STREAM_URL to the public wss URL + /media-stream"
  );
});

async function shutdown() {
  console.info("[voice-server] shutting down");
  wss.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
