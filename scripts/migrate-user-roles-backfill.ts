// One-off: sync User.roles with User.role for every user whose role was changed before #255.
//
//   pnpm tsx scripts/migrate-user-roles-backfill.ts
//
// `setUserRole` wrote only `role` and never `roles`, but every capability check resolves authority
// from `roles` and falls back to `[role]` only when that array is empty — which it never is, since
// #133 backfilled every existing user. So anyone whose role was changed through Settings → Roles
// (or its v1 API twin) still carries their OLD role in `roles` and is still judged on that old
// authority. The service now writes both; this repairs the rows written before it did.
//
// Guarded on `NOT (role = ANY(roles))`, so a genuine multi-role user (#133) whose set already
// contains their primary role — role MANAGER with roles {MANAGER, VERIFIER} — is left untouched.
// Idempotent: a no-op once every stale row has moved.
//
// Raw SQL, not user.updateMany: the whole repair is one set-based UPDATE whose guard compares one
// column against another, which Prisma's query API cannot express. Note the table is "users"
// (@@map) while the enum type is "Role".

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
	const fixed = await db.$executeRawUnsafe(
		`UPDATE "users" SET roles = ARRAY[role]::"Role"[] WHERE NOT (role = ANY(roles));`
	)
	console.log(`✔ Synced roles with role on ${fixed} user row(s).`)
}

main()
	.then(() => db.$disconnect())
	.catch(async (e) => {
		console.error(e)
		await db.$disconnect()
		process.exit(1)
	})
