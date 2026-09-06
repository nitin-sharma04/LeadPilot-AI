# Production environment checklist (Render / any host)

Set these in the **hosting dashboard** (never commit real values).

## Required

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Supabase **Transaction pooler** (`aws-0-REGION.pooler.supabase.com:6543`) with `?pgbouncer=true&connection_limit=1`. Username is `postgres.PROJECT_REF`. **Do not** use `db.*.supabase.co:5432` on Render — that host is often **IPv6-only** and causes `Can't reach database server`. |
| `DIRECT_URL` | Supabase **Session pooler** (`…pooler.supabase.com:5432`) for `prisma migrate deploy` |
| `AUTH_SECRET` | Long random secret (`openssl rand -base64 32`) |
| `APP_URL` | Public HTTPS origin, e.g. `https://leadpilot-ai-mnyw.onrender.com` |
| `AUTH_URL` | Same as `APP_URL` |
| `GEMINI_API_KEY` | Required when `AI_PROVIDER=gemini` |
| `TWILIO_ACCOUNT_SID` | If `VOICE_PROVIDER=twilio` |
| `TWILIO_AUTH_TOKEN` | If Twilio enabled |
| `TWILIO_PHONE_NUMBER` | E.164 |

## Strongly recommended

| Variable | Notes |
|----------|--------|
| `CRON_SECRET` | Protects `/api/cron/email-followups` |
| `VOICE_WEBHOOK_BASE_URL` | Public HTTPS of the Next.js app |
| `VOICE_STREAM_URL` | Public `wss://…/media-stream` of voice-server |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Live Calendar/Gmail |
| `GOOGLE_REDIRECT_URI` | `https://YOUR_DOMAIN/api/integrations/google-calendar/callback` |
| `GOOGLE_GMAIL_REDIRECT_URI` | `https://YOUR_DOMAIN/api/integrations/gmail/callback` |
| `GOOGLE_CALENDAR_DEMO` | `false` in production |
| `GOOGLE_GMAIL_DEMO` | `false` in production |
| `DEMO_MODE` | `false` in production |
| `HUBSPOT_DEMO` | `true` until HubSpot live credentials exist |

## Where to copy pooler URIs in Supabase

Dashboard → **Connect** → **ORMs** → **Prisma** (or Connection pooling) → copy **Transaction** + **Session** strings. Replace `[YOUR-PASSWORD]` and URL-encode special characters.

## After you get a Render URL

1. Set `APP_URL` + `AUTH_URL` to that HTTPS URL  
2. Update Google Cloud OAuth redirect URIs to match  
3. Update Twilio webhook base + Media Stream WSS  
4. Redeploy / restart  

## Verify

```bash
npx prisma migrate status
npm run smoke:production
curl https://YOUR_DOMAIN/api/health
```
