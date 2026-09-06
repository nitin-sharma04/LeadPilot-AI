# Fix: Render cannot use db.*.supabase.co (IPv6-only)

## Symptom
`Can't reach database server at db.miixtzoucovwyngonuko.supabase.co:5432`

## Cause
That host has **no IPv4 address**. Render only uses IPv4.

## Fix in Render → Environment

Delete the old `DATABASE_URL` and set **exactly** these two (password already URL-encoded):

### DATABASE_URL
```
postgresql://postgres.miixtzoucovwyngonuko:hh3Xqqywf%3F%2F%23kZv@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

### DIRECT_URL
```
postgresql://postgres.miixtzoucovwyngonuko:hh3Xqqywf%3F%2F%23kZv@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

Also set:
```
APP_URL=https://leadpilot-ai-mnyw.onrender.com
AUTH_URL=https://leadpilot-ai-mnyw.onrender.com
```

### Important paste rules
- Do **not** wrap in quotes on Render
- Do **not** replace `%3F%2F%23` with raw `?/#` (that causes `invalid port number`)
- Username must be `postgres.miixtzoucovwyngonuko` (includes project ref)
- Host must be `aws-0-ap-south-1.pooler.supabase.com` (**not** `db.miixtzoucovwyngonuko.supabase.co`)

Then **Manual Deploy → Clear build cache & deploy**.

### Verify
Open: `https://leadpilot-ai-mnyw.onrender.com/api/health`

You want:
```json
{
  "database": "ok",
  "dbHost": "aws-0-ap-south-1.pooler.supabase.com:6543",
  "usesIpv6OnlyDirect": false
}
```

If `dbHost` still shows `db.miixtzoucovwyngonuko.supabase.co:5432`, Render did not pick up the new env var yet.
