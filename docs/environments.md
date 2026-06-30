# Environment Runbook

## Local Development (isolated)

1. Copy `.env.example` to `.env` and fill local values.
2. Ensure these values are set:
   - `APP_ENV=development`
   - `REDIS_MODE=local`
   - `LOCAL_REDIS_URL=redis://127.0.0.1:6379`
   - `COMMUNITY_SIGNING_SECRET=<a long random development-only value>`
3. Start local Redis:
   - `docker compose -f docker-compose.local.yml up -d redis`
4. Start app:
   - `npm run dev`

The app uses local Redis and prefixes keys with `dev:` to isolate local data.

## Production

1. Do not use a production env file in the repo.
2. Put production secrets in Cloudflare environment variables/secrets.
3. Set:
   - `APP_ENV=production`
   - `REDIS_MODE=upstash`
   - `TURNSTILE_BYPASS_IN_DEV=false`
   - `COMMUNITY_SIGNING_SECRET`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Keep `.env.example` as the only committed reference template.

The deployed Worker is configured by `wrangler.jsonc`. Avoid mirroring production secrets into local files; keep them in Cloudflare so local development cannot accidentally target production services.

Keystatic OAuth origin override (optional):

- Set `KEYSTATIC_PUBLIC_ORIGIN` only if callback URLs need a forced canonical host.
- Match it exactly with the domain used in GitHub OAuth callback settings.

## Secret Rotation

If any secret is exposed in git history:

1. Rotate it immediately at provider (Upstash, Spotify, Cloudflare, etc.).
2. Update Cloudflare Worker variables/secrets.
3. Revoke old values permanently.
4. Confirm app health after rollout.
