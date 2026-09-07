# Realtime voice on Render (Gemini Live)

## Root cause (why calls were turn-based)

Production stamped `voiceMode=turn_based` because:

1. `VOICE_STREAM_URL` pointed at an ephemeral Cloudflare/ngrok tunnel, **or**
2. `VOICE_STREAM_URL` was unset on the Next.js service, **or**
3. The voice-server WebSocket service was not deployed / not reachable

`resolveEffectiveVoiceMode()` intentionally rejects trycloudflare/ngrok URLs when `NODE_ENV=production` unless `VOICE_ALLOW_TUNNEL=true`.

## Target architecture

```
Phone
  → Twilio Programmable Voice
  → Media Stream (WSS)
  → Render: leadpilot-voice (/media-stream)
  → Gemini Live (bidirectional audio)
  → Twilio → Phone

Render: leadpilot-web (Next.js + Auth + Prisma APIs)
Supabase: PostgreSQL
```

Turn-based Gather remains the automatic fallback when realtime prerequisites are missing.

## Deploy voice-server

1. Create/update Render Web Service **leadpilot-voice** (see `render.yaml`).
2. Build from repo root:
   - Build: `npm ci && npx prisma generate && npm --prefix voice-server ci`
   - Start: `npm --prefix voice-server run start`
   - Health: `/health`
3. Set env on **leadpilot-voice**:
   - `DATABASE_URL` (same Supabase pooler URL as web)
   - `GEMINI_API_KEY`
   - `GEMINI_LIVE_MODEL` (e.g. `gemini-3.1-flash-live-preview`)
   - `GEMINI_LIVE_VOICE=Aoede`
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (for REST hangup)
   - `APP_URL=https://leadpilot-ai-mnyw.onrender.com`
   - `VOICE_MAX_CALL_DURATION_SECONDS=600`

4. After deploy, open `https://<voice-host>/health` — expect `"status":"ok"`.

## Wire Next.js to realtime

On **leadpilot-web** set:

```
VOICE_MODE=realtime
VOICE_STREAM_URL=wss://<voice-host>/media-stream
VOICE_WEBHOOK_BASE_URL=https://leadpilot-ai-mnyw.onrender.com
GEMINI_API_KEY=...
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
```

Do **not** use trycloudflare/ngrok for production.

## Verify

1. `GET /api/health` on the web app → `voice.effectiveMode` should be `"realtime"`, `voice.voiceServerHealth` `"ok"`.
2. Start an AI call from a lead.
3. UI badge should say **Realtime (Gemini Live)** / **Realtime AI active**.
4. Logs should **not** contain `[voice] realtime unavailable; using turn_based`.
5. Confirm barge-in, booking, hangup, transcript, and summary still work.

## Fallback

If realtime cannot start, the web app stamps `turn_based` and uses Gather + fast Gemini text. That path is intentional and logged with `fallbackReason`.
