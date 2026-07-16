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

# The pg_isready above only proves Postgres is up *inside* the container — it does
# NOT prove the host can reach it. If the docker0 bridge is down (or a firewall drops
# bridge traffic), docker-proxy still accepts on :${DB_PORT} but can't relay to the
# container, so every DB connection hangs until Prisma times out with P1001. Probe the
# real relay target here so that failure is loud and actionable instead of silent.
echo "==> Verifying the host can actually reach the container..."
CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${CONTAINER}" 2>/dev/null)
if [ -n "${CONTAINER_IP}" ] && ! timeout 5 bash -c "exec 3<>/dev/tcp/${CONTAINER_IP}/5432" 2>/dev/null; then
  echo "    ERROR: Postgres is running, but the host cannot reach it at ${CONTAINER_IP}:5432." >&2
  echo "           docker-proxy accepts on :${DB_PORT} but can't relay to the bridge, so DB" >&2
  echo "           connections would hang until Prisma times out (P1001)." >&2
  DOCKER0_STATE=$(ip -br link show docker0 2>/dev/null | awk '{print $2}')
  if [ "${DOCKER0_STATE}" != "UP" ] && [ "${DOCKER0_STATE}" != "UNKNOWN" ]; then
    echo "           Cause: the docker0 bridge is ${DOCKER0_STATE:-missing}. Bring it up with:" >&2
    echo "               sudo ip link set docker0 up" >&2
  else
    echo "           Check host firewall / nftables FORWARD rules for the docker bridge." >&2
  fi
  exit 1
fi

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
