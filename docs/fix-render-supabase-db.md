# Fix: Render cannot use db.*.supabase.co (IPv6-only)

## Symptom
`Can't reach database server at db.*.supabase.co:5432`

## Cause
That host has **no IPv4 address**. Render only uses IPv4.

## Fix in Render → Environment

In Supabase: **Project Settings → Database → Connection string → Connection pooling**.

Use:

| Env var | Mode | Port | Notes |
|---------|------|------|--------|
| `DATABASE_URL` | Transaction | `6543` | Add `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Session | `5432` | For `prisma migrate deploy` |

### Required shape
```
postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:<PORT>/postgres
```

### Important paste rules
- Do **not** wrap in quotes on Render
- URL-encode special characters in the password (`?` → `%3F`, `/` → `%2F`, `#` → `%23`)
- Username must be `postgres.<PROJECT_REF>` (not bare `postgres`)
- Host must be `….pooler.supabase.com` (**not** `db.<PROJECT_REF>.supabase.co`)

Also set:
```
APP_URL=https://<your-render-service>.onrender.com
AUTH_URL=https://<your-render-service>.onrender.com
```

Then **Manual Deploy → Clear build cache & deploy**.

### Verify
Open: `https://<your-service>.onrender.com/api/health`

You want:
```json
{
  "database": "ok",
  "dbHost": "aws-0-<region>.pooler.supabase.com:6543",
  "usesIpv6OnlyDirect": false
}
```

If `dbHost` still shows `db.*.supabase.co:5432`, Render did not pick up the new env var yet.

Copy the exact encoded URLs from your local `.env` / `.env.local` (already fixed for this project) into the Render dashboard — do not paste the raw password with `?/#`.
