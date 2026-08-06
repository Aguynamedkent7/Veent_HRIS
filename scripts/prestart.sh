#!/bin/sh
# Everything that must run against the production database before `node build` serves.
#
# Compose (docker-compose.yml, `app`) and CI (.github/workflows/ci.yml, `schema-upgrade`)
# both run THIS file, so the sequence that deploys and the sequence CI tests cannot drift
# apart (#236).
set -e

# Rename FULL_TIME → REGULAR before the push (#172). The rename has to lead: `db push`
# cannot express one, so it sees a value dropped and another added and recreates the type —
# dropping the rows that use it, or refusing outright. Deploy is fully automatic
# (deploy.yml), so there is no window to run this by hand. Idempotent: a no-op on every
# start after the first.
pnpm exec tsx scripts/migrate-employment-type-regular.ts

# Swap for `prisma migrate deploy` once you adopt real Prisma migrations.
pnpm exec prisma db push --skip-generate
