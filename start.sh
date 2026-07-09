#!/usr/bin/env bash
set -e

CONTAINER="veent_wifiportal-db-1"
DB_NAME="veent_hris"
DB_USER="veent"
DB_PASS="veent"
DB_PORT="5432"

echo "==> Checking Docker container..."
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "    Starting container ${CONTAINER}..."
  docker start "${CONTAINER}"
  sleep 2
else
  echo "    Container already running."
fi

echo "==> Ensuring database '${DB_NAME}' exists..."
docker exec "${CONTAINER}" psql -U root -d local -tc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" \
  | grep -q 1 || \
  docker exec "${CONTAINER}" psql -U root -d local \
    -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" \
    -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" \
    -c "ALTER USER ${DB_USER} CREATEDB;" \
  && echo "    Database created." || echo "    Database already exists."

echo "==> Syncing Prisma schema..."
pnpm exec prisma db push --skip-generate

echo "==> Checking if seed is needed..."
ORG_COUNT=$(docker exec "${CONTAINER}" psql -U veent -d "${DB_NAME}" -tc \
  "SELECT COUNT(*) FROM \"Organization\";" 2>/dev/null | tr -d ' ' || echo "0")

if [ "${ORG_COUNT}" = "0" ] || [ -z "${ORG_COUNT}" ]; then
  echo "==> Seeding database..."
  pnpm db:seed
else
  echo "    Database already seeded (${ORG_COUNT} organization(s) found)."
fi

echo "==> Starting dev server..."
pnpm dev
