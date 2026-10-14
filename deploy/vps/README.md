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

## Backups

Redis writes AOF + RDB into the `redis-data` volume. Get a copy off the box:

```bash
mkdir -p ~/backups
# crontab -e on the VPS — nightly RDB copy, keep 14 days
0 3 * * * cd ~/oddava-storage && docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE' && sleep 30 && docker compose cp redis:/data/dump.rdb ~/backups/dump-$(date +\%F).rdb && find ~/backups -name 'dump-*.rdb' -mtime +14 -delete
```

Then ship `~/backups` somewhere else (e.g. `rclone sync` to Cloudflare R2 or
Backblaze B2). A backup on the same disk is not a backup.

## Operating it

```bash
docker compose logs -f srh                 # request errors
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO memory'
docker compose pull && docker compose up -d   # updates
```

`maxmemory` is 512mb with `noeviction`: when full, writes fail loudly instead of
silently evicting notes. Watch `used_memory_human` and raise it if needed.
