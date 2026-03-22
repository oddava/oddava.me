# Environment Runbook

## Local Development (isolated)

1. Copy `.env.example` to `.env.development` and fill local values.
2. Ensure these values are set:
   - `APP_ENV=development`
   - `REDIS_MODE=local`
   - `LOCAL_REDIS_URL=redis://127.0.0.1:6379`
3. Start local Redis:
   - `docker compose up -d redis`
4. Start app:
   - `npm run dev`

The app uses local Redis and prefixes keys with `dev:` to isolate local data.

## Production

1. Do not use `.env.production` in git.
2. Put all production secrets in Vercel project environment variables.
3. Set:
   - `APP_ENV=production`
   - `REDIS_MODE=upstash`
   - `TURNSTILE_BYPASS_IN_DEV=false`
4. Use `.env.production.example` only as a reference template.

## Secret Rotation

If any secret is exposed in git history:

1. Rotate it immediately at provider (Upstash, Spotify, Cloudflare, etc.).
2. Update Vercel environment variables.
3. Revoke old values permanently.
4. Confirm app health after rollout.
