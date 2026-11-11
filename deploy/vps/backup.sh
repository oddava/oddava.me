#!/usr/bin/env bash
# Nightly off-site backup of the VPS stack, encrypted with restic.
#
# One snapshot holds:
#   stage/redis/dump.rdb   a fresh, consistent Redis snapshot (BGSAVE)
#   stage/rustfs/<bucket>  every object, exported over the S3 API as plain
#                          files — restorable into any S3 store, or readable
#                          without one
#   stage/config/          compose.yml, redis.conf and .env (all the keys)
#   rustfs-volume/         the raw RustFS volume, for its IAM users, access
#                          keys and bucket settings, which the S3 export can't see
#
# The repository and its credentials come from backup.env (see
# backup.env.example). Run from cron; see README.md for setup and restore.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"
STACK=$(basename "$PWD") # compose project name: networks/volumes are prefixed by it
STAGE=${BACKUP_STAGE:-$HOME/backup-staging}
ENV_FILE=${BACKUP_ENV:-backup.env}
RESTIC_IMAGE=restic/restic:0.19.1
RCLONE_IMAGE=rclone/rclone:1.75.2

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

set -a
# shellcheck source=/dev/null
. ./.env
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

# Dead man's switch: with HEALTHCHECK_URL set (a healthchecks.io ping URL),
# each run reports its start and exit status. The service alerts on a failed
# run *and* on a run that never reports at all — a dead VPS, a stopped cron —
# which a notify-on-error hook here could never catch.
ping() {
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$HEALTHCHECK_URL$1" || true
}
trap 'ping "/$?"' EXIT
ping /start

# One run at a time: a slow upload must not overlap the next night's run.
exec 9>"$STAGE.lock"
flock -n 9 || {
  log 'another backup is still running; skipping'
  exit 1
}

redis_cli() {
  docker compose exec -T redis sh -c \
    'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning "$@"' redis-cli "$@"
}

restic() {
  docker run --rm -i \
    --network "${STACK}_default" \
    --hostname "$STACK" \
    --env-file "$ENV_FILE" \
    -v "$STAGE:/stage:ro" \
    -v "${STACK}_rustfs-data:/rustfs-volume:ro" \
    -v "$HOME/.cache/restic:/root/.cache/restic" \
    "$RESTIC_IMAGE" "$@"
}

mkdir -p "$STAGE"/{redis,rustfs,config} "$HOME/.cache/restic"
chmod 700 "$STAGE"

log 'redis: snapshotting'
before=$(redis_cli LASTSAVE)
# Fails harmlessly if a save is already running; we wait for LASTSAVE either way.
redis_cli BGSAVE >/dev/null || true
for _ in $(seq 120); do
  [ "$(redis_cli LASTSAVE)" != "$before" ] && break
  sleep 1
done
if [ "$(redis_cli LASTSAVE)" = "$before" ]; then
  log 'redis: BGSAVE did not finish within 120s'
  exit 1
fi
redis_cli INFO persistence | grep -q '^rdb_last_bgsave_status:ok' || {
  log 'redis: last BGSAVE failed'
  exit 1
}
docker compose cp redis:/data/dump.rdb "$STAGE/redis/dump.rdb" >/dev/null 2>&1 || {
  log 'redis: copying dump.rdb out of the container failed'
  exit 1
}

log 'rustfs: exporting objects'
docker run --rm \
  --network "${STACK}_default" \
  --user "$(id -u):$(id -g)" \
  -v "$STAGE/rustfs:/out" \
  -e RCLONE_CONFIG_SRC_TYPE=s3 \
  -e RCLONE_CONFIG_SRC_PROVIDER=Other \
  -e RCLONE_CONFIG_SRC_ENDPOINT=http://rustfs:9000 \
  -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$RUSTFS_ACCESS_KEY" \
  -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$RUSTFS_SECRET_KEY" \
  "$RCLONE_IMAGE" sync src: /out --fast-list --log-level ERROR

log 'config: copying'
cp compose.yml redis.conf .env "$STAGE/config/"
chmod 600 "$STAGE/config/.env"

log 'restic: backing up'
restic backup --tag nightly --quiet /stage /rustfs-volume
restic forget --tag nightly --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
  --prune --quiet
# Sundays also re-download and verify a tenth of the stored data.
if [ "$(date +%u)" = 7 ]; then
  restic check --read-data-subset=10% --quiet
else
  restic check --quiet
fi

log 'done'
restic snapshots --tag nightly --latest 1 --compact
