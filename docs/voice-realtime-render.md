# leadpilot-voice (Render) — production deploy

Independent Web Service for Twilio Media Streams ↔ Gemini Live.

## Exact Render settings

| Setting | Value |
|---------|--------|
| **Name** | `leadpilot-voice` |
| **Root Directory** | `voice-server` |
| **Runtime** | Node |
| **Build Command** | `npm ci && npm run build` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |

The process binds to `0.0.0.0` and `process.env.PORT` (Render injects `PORT`).

## Required environment variables (names only)

Set these in the Render dashboard (never commit secret values):

| Name | Notes |
|------|--------|
| `DATABASE_URL` | Same Supabase Postgres URL the Next.js app uses (pooler OK for runtime reads/writes) |
| `GEMINI_API_KEY` | Server-side only |
| `GEMINI_LIVE_MODEL` | e.g. `gemini-3.1-flash-live-preview` |
| `GEMINI_LIVE_VOICE` | e.g. `Aoede` (optional if defaulted in dashboard) |
| `TWILIO_ACCOUNT_SID` | For REST hangup |
| `TWILIO_AUTH_TOKEN` | For REST hangup |
| `APP_URL` | Public Next.js origin, e.g. `https://leadpilot-ai-mnyw.onrender.com` |
| `VOICE_MAX_CALL_DURATION_SECONDS` | e.g. `600` |
| `NODE_ENV` | `production` |
| `PORT` | Injected by Render — do not set manually unless required |

## Prisma

- Uses the **existing** monorepo schema at `../prisma/schema.prisma` (Render clones the full repo even with `rootDir: voice-server`).
- Build copies that schema to a temp file under `voice-server/` and runs `prisma generate` so the client is written into **this** service’s `node_modules` (not a parent Next.js install).
- No second schema in git, no second database, no migrations from this service.
- `DIRECT_URL` is **not** required on the voice service (runtime uses `DATABASE_URL` only).

## After voice is live — wire the Next.js app

On **leadpilot-web**:

```
VOICE_MODE=realtime
VOICE_STREAM_URL=wss://<leadpilot-voice-host>/media-stream
```

Do **not** use Cloudflare/ngrok tunnels in production.

## Verify

```bash
# From voice-server/
npm ci
npm run typecheck
npm run build

# From repo root
npm run smoke:production
npx tsc --noEmit
npm run lint
npm run build
```

Then open `https://<leadpilot-voice-host>/health` and confirm `"status":"ok"`.
