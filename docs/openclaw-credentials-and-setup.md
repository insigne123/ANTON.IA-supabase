# OpenClaw Credentials and Setup (Single Org)

This setup is server-side only.

- It does not change the UI.
- It does not require app users to do anything.
- OpenClaw starts using these APIs only after you configure it and give it the token flow.

## 1) Required environment variables

Add these vars to your deployment environment (and local `.env.local` if needed):

- `OPENCLAW_ORG_ID`
- `OPENCLAW_API_KEY` (or `OPENCLAW_API_KEYS` for rotation)
- `OPENCLAW_TOKEN_SECRET`
- `OPENCLAW_TOKEN_TTL_SECONDS`
- `OPENCLAW_SCOPES`
- `INTERNAL_API_SECRET`
- `CRON_SECRET`

Reference values are in `.env.example`.

## 2) Where to get each credential

### OPENCLAW_ORG_ID

From Supabase SQL editor:

```sql
select om.organization_id
from public.organization_members om
join auth.users u on u.id = om.user_id
where lower(u.email) = lower('tu-email@dominio.com')
limit 1;
```

Use that UUID as `OPENCLAW_ORG_ID`.

### OPENCLAW_API_KEY

Generate a long random value (you create this yourself):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set the output as `OPENCLAW_API_KEY`.

### OPENCLAW_TOKEN_SECRET

Generate another random value (different from API key):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Set it as `OPENCLAW_TOKEN_SECRET`.

### INTERNAL_API_SECRET

Generate another random secret used only for internal server-to-server calls:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set it as `INTERNAL_API_SECRET` in:

- Next.js runtime env
- Firebase Functions env (if worker calls Next endpoints)

### OPENCLAW_SCOPES

Use a CSV list. Suggested initial value:

```text
system:read,missions:read,missions:write,tasks:read,tasks:admin,leads:read,leads:write,campaigns:read,campaigns:write,campaigns:run,contacted:read,contacted:write
```

### CRON_SECRET

If already configured for cron endpoints, keep it.
If not, generate one random secret and set it.

## 3) Token exchange flow (what OpenClaw should do)

1. Exchange API key for short bearer token:

```http
POST /api/openclaw/v1/auth/exchange
Headers:
  x-openclaw-key: <OPENCLAW_API_KEY>
```

2. Use response token in all OpenClaw requests:

```http
Authorization: Bearer <token>
```

3. Refresh token when expired.

## 4) Quick smoke test

After deploy:

1. `POST /api/openclaw/v1/auth/exchange`
2. `GET /api/openclaw/v1/whoami`
3. `GET /api/openclaw/v1/overview`
4. `GET /api/openclaw/v1/antonia/missions`
5. `GET /api/openclaw/v1/antonia/tasks`

Or run the automated smoke script after starting the app:

```bash
npm run dev
# in another terminal
npm run smoke:openclaw
```

If your app is on another URL:

```bash
OPENCLAW_BASE_URL="https://tu-dominio" npm run smoke:openclaw
```

## 5) No-UI-impact guarantee

This integration is isolated under `/api/openclaw/v1/*` and server hardening.
No page/component behavior is changed by default.
