#!/usr/bin/env bash
set -e

CONTAINER="veent-db-5433"
DB_NAME="veent_hris"
DB_USER="veent"
DB_PASS="veent"
DB_PORT="5433"
PG_IMAGE="postgres:18"

echo "==> Checking Docker container..."
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "    Container already running."
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "    Starting existing container ${CONTAINER}..."
  docker start "${CONTAINER}"
else
  # Nothing named ${CONTAINER} exists — make sure the host port is free before we bind it.
  echo "    Checking port ${DB_PORT} is free..."
  PORT_OWNER=$(docker ps --filter "publish=${DB_PORT}" --format '{{.Names}}')
  if [ -n "${PORT_OWNER}" ]; then
    echo "    ERROR: another container is already publishing port ${DB_PORT}: ${PORT_OWNER}" >&2
    exit 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/${DB_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "    ERROR: something is already listening on port ${DB_PORT} (not a Docker container)." >&2
    echo "           Free the port or change DB_PORT before running again." >&2
    exit 1
  fi

  echo "    Creating container ${CONTAINER}..."
  docker run -d --name "${CONTAINER}" \
    -e POSTGRES_USER="${DB_USER}" \
    -e POSTGRES_PASSWORD="${DB_PASS}" \
    -e POSTGRES_DB="${DB_NAME}" \
    -p "${DB_PORT}:5432" \
    "${PG_IMAGE}"
fi

echo "==> Waiting for Postgres to accept connections..."
until docker exec "${CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; do
  sleep 1
done

echo "==> Syncing Prisma schema..."
pnpm exec prisma db push --skip-generate

echo "==> Checking if seed is needed..."
ORG_COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tc \
  "SELECT COUNT(*) FROM \"Organization\";" 2>/dev/null | tr -d ' ' || echo "0")

if [ "${ORG_COUNT}" = "0" ] || [ -z "${ORG_COUNT}" ]; then
  echo "==> Seeding database..."
  pnpm db:seed
else
  echo "    Database already seeded (${ORG_COUNT} organization(s) found)."
fi

echo "==> Starting dev server + Discord bot (Ctrl-C stops both)..."
# Kill the whole process group on exit so the bot doesn't linger.
trap 'kill 0' EXIT INT TERM
# Bot in the background (fails soft if its env is missing); dev server in the foreground.
pnpm bot &
pnpm dev
