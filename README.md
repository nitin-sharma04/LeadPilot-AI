# LeadPilot AI

Premium AI-powered sales automation platform.

**Tagline:** Turn every lead into an opportunity.

## Phase status

- **Phase 1:** Polished SaaS frontend ✅
- **Phase 2:** PostgreSQL + Prisma + Auth.js + multi-tenant APIs ✅
- **Phase 3:** Gemini Lead Intelligence ✅
- **Phase 4:** Gemini AI Sales Response Generator ✅
- **Phase 5A:** Turn-based AI phone agent (Twilio Gather/Say) ✅
- **Phase 5B:** Realtime AI voice streaming (Twilio Media Streams + Gemini Live) ✅
- **Phase 6:** Appointment booking + Google Calendar OAuth ✅
- **Phase 7:** Gmail + follow-up automation ✅
- **Phase 8:** Lead capture + HubSpot CRM ✅
- **Production foundation:** Auth signup/onboarding, env validation, health, Render-ready docs ✅ (billing = Phase 9, not started)

See [docs/production-deployment.md](docs/production-deployment.md) for deploy, migrations, and production checklist.

## Stack

- Next.js 15 (App Router) + TypeScript
- Separate `voice-server` (Node WebSocket) for realtime media
- PostgreSQL + Prisma
- Auth.js (NextAuth v5)
- Gemini text + Gemini Live native audio
- Twilio Programmable Voice + bidirectional Media Streams
- Google Calendar API (optional OAuth sync)

## Environment

Copy `.env.example` → `.env` / `.env.local`. Never commit secrets. Never use `NEXT_PUBLIC_` for keys.

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-latest
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Aoede

VOICE_PROVIDER=twilio
VOICE_MODE=realtime
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
VOICE_WEBHOOK_BASE_URL=https://<ngrok-to-next>
VOICE_STREAM_URL=wss://<ngrok-to-voice-server>
VOICE_SERVER_PORT=8081

# Phase 6 — Google Calendar (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google-calendar/callback
```

### Google Calendar setup

1. Create an OAuth 2.0 Client ID in Google Cloud Console (Web application).
2. Add authorized redirect URI:
   - Local: `http://localhost:3000/api/integrations/google-calendar/callback`
   - Production: `https://YOUR_DOMAIN/api/integrations/google-calendar/callback`
3. Enable the **Google Calendar API**.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env.local`.
5. In LeadPilot → **Integrations** → **Connect Google Calendar**.

Without Google connected, appointments still save as **LeadPilot appointment** records (never fake external events).

### Appointment / AI booking behavior

- Manual create/reschedule/cancel via Appointments page and Lead detail.
- Conflict checks: existing LeadPilot appointments + Google free/busy when connected.
- Idempotent AI booking key: `call:{callId}`.
- AI never claims “you're booked” unless `bookAppointment` succeeds.
- Ambiguous times (“Tuesday morning”, “around 2”) are **not** auto-booked.
- Company default timezone: `Company.timezone` (IANA). Appointment rows store their own `timezone`.

## Setup

```bash
docker compose up -d
npm install
npm --prefix voice-server install
npx prisma generate
npx prisma db push
npm run db:seed
```

## Run locally (Phase 5B realtime)

You need **two public tunnels** (or one multi-port setup):

1. Next.js HTTP webhooks → `VOICE_WEBHOOK_BASE_URL`
2. Voice server WSS → `VOICE_STREAM_URL` (must reach `/media-stream`)

Example:

```bash
# terminal 1 — Next.js
npm run dev

# terminal 2 — realtime media bridge
npm run voice:dev

# terminal 3 — tunnel Next (HTTP)
ngrok http 3000

# terminal 4 — tunnel voice-server (HTTP upgrade / WSS)
ngrok http 8081
```

Set:

- `VOICE_WEBHOOK_BASE_URL=https://<next-ngrok>`
- `VOICE_STREAM_URL=wss://<voice-ngrok>` (path `/media-stream` is added if missing)
- `VOICE_MODE=realtime`

### Architecture

**Realtime (5B):**

Phone → Twilio → `<Connect><Stream>` → `voice-server` WSS → audio convert (µ-law 8k ↔ PCM 16k/24k) → Gemini Live `BidiGenerateContent` → audio back → Twilio → Phone

**Human voice / transcripts:**

- Voice: `GEMINI_LIVE_VOICE` (default `Aoede`; also `Callirrhoe`, `Achird`, `Zubenelgenubi`, `Sulafat`)
- SMART input transcription when supported; only finalized utterances are persisted
- Barge-in clears Twilio outbound audio (`clear`) and drops stale agent audio
- Clear end-call phrases / agent farewell → short goodbye → Twilio media mark → REST hangup (`Status=completed`)
- Idempotent end-call guard; `VOICE_MAX_CALL_DURATION_SECONDS` (default 600) safety ceiling
- Appointments are never claimed “booked” without a real calendar integration

**Fallback (5A):** If realtime config is incomplete, LeadPilot records `voiceMode=turn_based` and uses Gather/Say. UI shows **Turn-based AI**, never pretends realtime.

### Security

- Stream sessions require `callId` + `streamToken` custom parameters
- Token stored on Call; voice-server validates against PostgreSQL
- Twilio HTTP webhooks verify `X-Twilio-Signature`
- Secrets never sent to the browser

### Test one controlled call

1. Configure Twilio + Gemini + both public URLs
2. Use a phone number you own (E.164)
3. Lead Detail → **Call with AI**
4. Speak, interrupt the agent, continue several turns, hang up
5. Confirm transcript + summary on the lead / Calls page

Do not bulk-dial. Manual click-to-call only.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Next.js app |
| `npm run voice:dev` | Realtime voice WebSocket server |
| `npm run build` | Next.js production build |
| `npm run voice:typecheck` | Typecheck voice-server |
| `npm run db:seed` | Seed demo workspace |

## Privacy / consent

- Agent identifies as AI
- Opt-out ends the call and notes the lead
- No mass dialing / campaigns
