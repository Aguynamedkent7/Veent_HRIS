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

# Collapse User.role into User.roles and backfill AuditLog.actorRoles before the push (#282).
# The backfill has to lead: `db push` adds a column and drops one in a single pass, so it can
# never copy the old column's data into the new one — and once the scalars are dropped the
# history is gone. Deploy is fully automatic (deploy.yml), so there is no window to run this by
# hand. Idempotent: a no-op on a fresh database and on every start after the first.
pnpm exec tsx scripts/migrate-user-role-to-roles.ts

# Add time_logs.dedupKey and its unique index before the push (#200). Push refuses to add a unique
# constraint to a populated table without --accept-data-loss, and this file passes no such flag by
# design. Creating the index here means push finds it already present and warns about nothing.
# Idempotent: a no-op on a fresh database and on every start after the first.
pnpm exec tsx scripts/migrate-timelog-dedup-key.ts

# Swap for `prisma migrate deploy` once you adopt real Prisma migrations.
pnpm exec prisma db push --skip-generate
