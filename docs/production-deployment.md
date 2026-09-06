# Production deployment — LeadPilot AI

This guide prepares Phases 1–8 for a real hosted environment.  
**Do not** run `prisma migrate reset` against production.

## Architecture

```
Browser → Next.js (Render Web Service)
              ↓
         PostgreSQL (Supabase / Render / other)
              ↓
Optional: voice-server (separate Web Service, WSS /media-stream)
```

Provider-agnostic: only `DATABASE_URL` is required for persistence.

## 1. Database setup

### Staging
- Supabase free Postgres **or** Render Postgres (note free tiers may sleep/expire).

### Production
- Managed Postgres with automated backups.

```bash
# From a clean empty database:
npx prisma migrate deploy
npx prisma generate
```

**Never** auto-seed production. Demo seed:

```bash
# Local / intentional demo env only
SEED_WIPE=true ALLOW_PROD_SEED=true npm run db:seed   # destructive wipe — local only
# Soft seed (demo company only):
npm run db:seed
```

## 2. Required environment variables

See `.env.example` for the full list. Minimum production:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `AUTH_SECRET` | Auth.js JWT |
| `APP_URL` / `AUTH_URL` | Canonical public HTTPS URL |
| `GEMINI_API_KEY` | AI (if AI_PROVIDER=gemini) |

Feature-gated:

- Twilio when `VOICE_PROVIDER=twilio`
- Google when calendar/gmail demo flags are false
- HubSpot when `HUBSPOT_DEMO=false`
- `CRON_SECRET` for follow-up scheduler
- `DEMO_MODE=false` in production (default)

## 3. OAuth callbacks

Register these on your production domain (not localhost):

```
https://YOUR_DOMAIN/api/integrations/google-calendar/callback
https://YOUR_DOMAIN/api/integrations/gmail/callback
https://YOUR_DOMAIN/api/integrations/hubspot/callback
```

## 4. Render Web Service

1. Connect the GitHub repo  
2. Runtime: Node  
3. **Node version:** `20.19.0` (set `NODE_VERSION=20.19.0` or use `.nvmrc`)  
4. Build: `npm ci && NODE_OPTIONS=--max-old-space-size=2048 npm run build`  
5. Start: `npx prisma migrate deploy && npm start`  
6. Health check: `/api/health`  
7. **Environment (required):** paste from your local secrets — use **Supabase** `DATABASE_URL`, not a Render Postgres unless you intend to.

| Key | Example |
|-----|---------|
| `DATABASE_URL` | Supabase direct Postgres URI |
| `AUTH_SECRET` | random 32+ bytes |
| `APP_URL` | `https://YOUR-SERVICE.onrender.com` |
| `AUTH_URL` | same as `APP_URL` |
| `GEMINI_API_KEY` | your key |
| `TWILIO_*` | if using voice |
| `DEMO_MODE` | `false` |

8. Custom domain → update `APP_URL` / OAuth redirects / Twilio URLs  

Signup/login create real `Company` + `User` rows in Supabase via Prisma (Auth.js + bcrypt). No demo seed required.

Optional second service for `voice-server/`:

- Bind `0.0.0.0` + `PORT`
- Path `/media-stream`
- Set `VOICE_STREAM_URL=wss://voice.YOUR_DOMAIN/media-stream`

`render.yaml` is a template — **no secrets inside**.

## 5. Cron / follow-ups

`POST /api/cron/email-followups` with:

```
Authorization: Bearer $CRON_SECRET
```

Use Render Cron Jobs, EasyCron, or GitHub Actions on a schedule.  
Does not depend on a browser being open.

## 6. Production smoke checklist

After deploy:

1. `GET /api/health` → `status: ok`, `database: ok`  
2. Signup real user → onboarding → dashboard  
3. Create lead → logout → login → lead persists  
4. Connect Calendar / Gmail with production callbacks  
5. Public lead capture with a workspace API key  
6. Duplicate capture returns same id  
7. Follow-up cron with secret  

Do not claim live Twilio/Gmail/HubSpot until those credentials are verified on the deployed URL.

## 7. Backup

Export via your provider (Supabase backup / `pg_dump`).  
Never delete production data as part of deploy.

## 8. Demo vs real

| Mode | How |
|------|-----|
| Demo workspace | `DEMO_MODE` + seed (`isDemo=true`) + Try Live Demo |
| Real workspace | `/signup` → own Company as OWNER → empty pipeline |

Production dashboards must never silently load Apex demo data.
