# Self-hosted storage on the VPS

Production Redis runs on a VPS, fronted by
[SRH](https://github.com/hiett/serverless-redis-http), which speaks the same
REST protocol as Upstash. The site itself stays a Cloudflare Worker and its code
is unchanged: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` keep their
names (they are deployed state) and simply point at SRH instead of Upstash.

```
Worker ──https──▶ Cloudflare edge ──tunnel──▶ cloudflared ─▶ srh:80 ─▶ redis:6379
```

The Cloudflare Tunnel dials _out_ from the VPS, so the VPS needs no open
inbound ports for this, gets TLS for free, and its IP stays private.

## Trade-offs

- **Uptime is ours.** If the VPS is down, notes, guestbook and Studio 503.
- **Latency.** Every uncached request goes from the visitor's Cloudflare colo
  to the VPS. Pick a region close to most visitors.
- **Backups are ours.** See below. The VPS holds the only live copy.

## 1. Prepare the VPS (once)

```bash
# as root on a fresh Debian/Ubuntu box
adduser deploy && usermod -aG sudo deploy
# from your laptop: ssh-copy-id deploy@<vps>, then confirm `ssh deploy@<vps>`
# works in a second terminal BEFORE the next lines. sshd keeps the first value
# it reads and cloud images ship 50-cloud-init.conf, so the file must sort first.
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-hardening.conf
sshd -t && systemctl restart ssh
apt update && apt install -y ufw unattended-upgrades
ufw default deny incoming && ufw allow OpenSSH && ufw enable
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
```

Verify it took — both must say `no`, and ufw must be `active`:

```bash
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'; sudo ufw status
```

Docker-published ports bypass `ufw`. That is why `compose.yml` publishes Redis
on `127.0.0.1` only and SRH not at all.

## 2. Create the tunnel

Log in to the Cloudflare account that **owns the domain** — a tunnel created in
another account connects fine but its hostname never resolves.

Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. On the install
screen copy only the token after `--token` (do not run the shown command).
Then add a public hostname (a.k.a. published application route):

| Subdomain | Domain     | Type   | URL      |
| --------- | ---------- | ------ | -------- |
| `redis`   | `<domain>` | `HTTP` | `srh:80` |

## 3. Start the stack

```bash
scp -r deploy/vps deploy@<vps>:~/oddava-storage       # from the repo
```

On the VPS:

```bash
cd ~/oddava-storage
printf 'REDIS_PASSWORD=%s\nSRH_TOKEN=%s\nTUNNEL_TOKEN=\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > .env && chmod 600 .env
nano .env                                  # paste the tunnel token
docker compose up -d
docker compose ps                          # redis healthy, srh and cloudflared up
docker compose logs cloudflared | grep -i registered
```

Smoke test (on the VPS, so the token never leaves it):

```bash
TOKEN=$(grep '^SRH_TOKEN=' .env | cut -d= -f2)
curl -sS https://redis.<domain> -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '["PING"]'
```

Expect `{"result":"PONG"}`; a wrong token must return `401`. If curl says
`Could not resolve host` right after creating the route, the VPS's upstream
resolver is likely caching the earlier NXDOMAIN (up to 30 min). Check the record
itself with `curl -s 'https://cloudflare-dns.com/dns-query?name=redis.<domain>&type=A' -H 'accept: application/dns-json'`
and retest with `curl --doh-url https://cloudflare-dns.com/dns-query …`.

## 4. Copy the data from Upstash

From the repo on your laptop, with the current Upstash credentials (already in
`.env`) as the source. The SRH token is read over SSH so it is never displayed:

```bash
TARGET_TOKEN=$(ssh deploy@<vps> "grep '^SRH_TOKEN=' ~/oddava-storage/.env | cut -d= -f2")
SOURCE_REDIS_REST_URL=$(grep '^UPSTASH_REDIS_REST_URL=' .env | cut -d= -f2- | tr -d '\r') \
SOURCE_REDIS_REST_TOKEN=$(grep '^UPSTASH_REDIS_REST_TOKEN=' .env | cut -d= -f2- | tr -d '\r') \
TARGET_REDIS_REST_URL=https://redis.<domain> TARGET_REDIS_REST_TOKEN="$TARGET_TOKEN" \
pnpm run redis:copy
```

It copies every key verbatim (strings, sets, lists, hashes, sorted sets, TTLs)
and prints both `DBSIZE`s at the end. Avoid Studio edits until step 5 is done;
if a guestbook entry slips in, re-run with `--overwrite` right before switching.

## 5. Switch the Worker

The Worker's settings are dashboard variables (`keep_vars` in
`wrangler.jsonc`), so `wrangler secret put` refuses these names with
`Binding name … already in use`. Edit them in the dashboard instead — both in
one deploy, so the Worker never runs with a mismatched URL and token:

1. Put the token on the Windows clipboard without displaying it (WSL):
   `ssh deploy@<vps> "grep '^SRH_TOKEN=' ~/oddava-storage/.env | cut -d= -f2 | tr -d '\n'" | clip.exe`
2. Workers & Pages → oddava-me → Settings → Variables and Secrets:
   `UPSTASH_REDIS_REST_URL` = `https://redis.<domain>`;
   `UPSTASH_REDIS_REST_TOKEN` = paste, type **Secret**. Deploy.

Load a note, `/admin/studio` and the guestbook. Rolling back is restoring the
two Upstash values; keep the Upstash database for a week.

Point your local `.env` at the VPS too, or `notes:export -- --target=prod`
keeps exporting the frozen Upstash copy.

## Rotating the SRH token

```bash
# on the VPS
cd ~/oddava-storage && sed -i "s/^SRH_TOKEN=.*/SRH_TOKEN=$(openssl rand -hex 32)/" .env && docker compose up -d
```

Then repeat step 5 for `UPSTASH_REDIS_REST_TOKEN`. The site errors between the
two, so do them back to back.

## Object storage (RustFS)

[RustFS](https://rustfs.com/) is an S3-compatible object store (Apache-2.0,
the MinIO-style successor now that MinIO's community edition is archived).

| What           | Where                          | Reachable from              |
| -------------- | ------------------------------ | --------------------------- |
| S3 API         | `https://s3.<domain>` (tunnel) | anywhere, signed only       |
| S3 API, direct | `127.0.0.1:9000` on the VPS    | `ssh -L` only               |
| Web console    | `127.0.0.1:9001` on the VPS    | `ssh -L` only, never public |

Setup, once:

```bash
# on the VPS — generates root keys straight into .env, never displayed
cd ~/oddava-storage && printf 'RUSTFS_ACCESS_KEY=%s\nRUSTFS_SECRET_KEY=%s\n' "admin-$(openssl rand -hex 4)" "$(openssl rand -hex 24)" >> .env
docker compose up -d
```

Then add a tunnel public hostname `s3` → `HTTP` → `rustfs:9000`. Do not add one
for the console.

**Console:** from the laptop, `ssh -N -L 19001:127.0.0.1:9001 deploy@<vps>`,
then open `http://localhost:19001` and sign in with the keys from
`grep RUSTFS_ ~/oddava-storage/.env` on the VPS. Create a scoped access key per
app there; keep the root keys for administration.

Local ports 19000/19001 rather than 9000/9001 on purpose: a local MinIO or
RustFS (common in dev stacks) already holds 9000/9001, and `ssh -L` then fails
to bind with only a warning — the browser silently reaches the local console
instead, which rejects these keys as "invalid login".

Buckets are private by default: an unsigned request gets `403`, and Cloudflare
does not cache signed requests (`cf-cache-status: BYPASS`), so a private object
fetched once is not served to anyone else.

**Clients and Cloudflare.** Plain SigV4 clients (curl `--aws-sigv4`, `aws4fetch`
in a Worker, most SDK calls) work through `s3.<domain>`: 300/300 signed
GET/HEAD requests passed in testing. The AWS CLI does not, reliably — it signs
extra headers that Cloudflare can rewrite in transit, so RustFS rejects them
with `SignatureDoesNotMatch`:

- its default (CRT) downloader signs `Content-Length: 0` on GETs, which
  Cloudflare drops: downloads failed 10/10;
- even with `preferred_transfer_client = classic`, about 1 in 40 `HEAD`
  requests still failed, in bursts.

So for the AWS CLI, rclone and other admin or bulk work, skip Cloudflare:

```bash
ssh -N -L 19000:127.0.0.1:9000 deploy@<vps>      # in one terminal
aws --endpoint-url http://127.0.0.1:19000 s3 ls  # in another
```

Requests through the tunnel are also capped at 100 MB per request on
Cloudflare's free plan; multipart uploads stay under it per part.

## Backups

`backup.sh` runs nightly at 03:15 UTC from the `deploy` user's crontab and
sends one encrypted, deduplicated [restic](https://restic.net) snapshot to
Cloudflare R2 (bucket `oddava-backups`). Each snapshot holds:

| Path in snapshot         | What                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `/stage/redis/dump.rdb`  | a fresh Redis snapshot (`BGSAVE`, waited on) — notes, media, guestbook |
| `/stage/rustfs/<bucket>` | every RustFS object exported over S3 as plain files                    |
| `/stage/config/`         | `compose.yml`, `redis.conf`, `.env` — every key needed to rebuild      |
| `/rustfs-volume/`        | the raw RustFS volume, for IAM users, access keys and bucket settings  |

Retention: 7 daily, 4 weekly, 6 monthly. Every run ends with `restic check`;
on Sundays it also re-downloads and verifies 10% of the stored data. Output is
appended to `~/backup.log`.

### Setup, once

1. In the Cloudflare account that owns the domain: R2 → create bucket
   `oddava-backups` (private), then R2 → Manage API tokens → create a token with
   **Object Read & Write** on that bucket only.
2. On the VPS, write `backup.env` (prompts for the R2 values, generates the
   restic password; nothing is echoed):

   ```bash
   cd ~/oddava-storage && read -rp 'R2 S3 endpoint: ' EP && read -rp 'R2 Access Key ID: ' AK && read -rsp 'R2 Secret Access Key (hidden): ' SK && echo && EP=${EP%/} && EP=${EP%/oddava-backups} && printf 'RESTIC_REPOSITORY=s3:%s/oddava-backups\nRESTIC_PASSWORD=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' "$EP" "$(openssl rand -base64 32 | tr -d '\n')" "$AK" "$SK" > backup.env && chmod 600 backup.env && unset AK SK
   ```

3. **Copy `RESTIC_PASSWORD` off the VPS** (password manager). Without it the
   backups cannot be decrypted — and a dead VPS is exactly when you need them.
   From WSL, without displaying it:
   `ssh deploy@<vps> "grep '^RESTIC_PASSWORD=' ~/oddava-storage/backup.env | cut -d= -f2- | tr -d '\n'" | clip.exe`
4. Initialise the repository, run once, then schedule:

   ```bash
   docker run --rm --env-file backup.env restic/restic:0.19.1 init
   ./backup.sh
   (echo '15 3 * * * $HOME/oddava-storage/backup.sh >> $HOME/backup.log 2>&1') | crontab -
   ```

### Checking on it

```bash
tail -20 ~/backup.log
docker run --rm --env-file ~/oddava-storage/backup.env restic/restic:0.19.1 snapshots
```

### Restoring

On any machine with Docker, given `backup.env` (or just the four values —
rebuild it from R2 and the saved password):

```bash
mkdir restore && docker run --rm --env-file backup.env -v "$PWD/restore:/restore" restic/restic:0.19.1 restore latest --target /restore
```

Then, on a fresh VPS (steps 1–3 above, with the tunnel token from the restored
`.env`):

- **Config:** copy `restore/stage/config/*` into `~/oddava-storage/`.
- **Redis:** seed the volume before Redis ever starts with AOF on. With
  `appendonly yes` and no AOF present, Redis 7 starts **empty and ignores
  `dump.rdb`** — so load it with AOF off, switch AOF on live (Redis writes a
  fresh AOF from memory), then start normally:

  ```bash
  docker compose up --no-start
  docker run --rm -v oddava-storage_redis-data:/data -v "$PWD/restore/stage/redis:/r:ro" alpine sh -c 'cp /r/dump.rdb /data/ && chown 999:999 /data/dump.rdb'
  docker run -d --name redis-restore -v oddava-storage_redis-data:/data -v "$PWD/redis.conf:/usr/local/etc/redis/redis.conf:ro" redis:7-alpine redis-server /usr/local/etc/redis/redis.conf --appendonly no
  docker exec redis-restore redis-cli DBSIZE                      # the restored key count
  docker exec redis-restore redis-cli CONFIG SET appendonly yes
  docker exec redis-restore redis-cli INFO persistence | grep -E '^aof_(enabled|rewrite_in_progress)'  # wait for 1 and 0
  docker rm -f redis-restore && docker compose up -d
  ```

- **RustFS:** start it empty and re-upload the exported objects with
  `rclone copy restore/stage/rustfs <remote>:` (tested path: the export is
  checked against the live bucket). To also keep IAM users and keys, copy
  `restore/rustfs-volume/` into the `rustfs-data` volume with RustFS stopped and
  `chown -R 10001:10001` it — that raw-volume path has not been exercised yet.

Tested on 2026-10-14: a snapshot pulled back from R2 gave all 82 Redis keys with
identical contents (per-key SHA-1 fingerprints) and byte-identical config; the
Redis steps above, run against a scratch volume with the production
`redis.conf`, came back with all 82 keys after a normal AOF-on restart; exported
objects matched the live bucket (`rclone check --download`).

## Operating it

```bash
docker compose logs -f srh                 # request errors
docker compose exec rustfs sh -c 'tail -f /logs/rustfs.log'   # RustFS logs to a file, not stdout
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO memory'
docker compose pull && docker compose up -d   # updates
```

`maxmemory` is 512mb with `noeviction`: when full, writes fail loudly instead of
silently evicting notes. Watch `used_memory_human` and raise it if needed.
