import { PrismaClient } from '@prisma/client'
import { seedProd } from './seed-core'

// Minimal production seed: tenants, org-level config, and the three admin accounts.
// For the full demo roster the test suite needs, use `prisma/seed-e2e.ts`.
const db = new PrismaClient()

seedProd(db)
	.then(() => {
		console.log('Prod seed complete. Logins:')
		console.log('  CEO:         ceo@veent.ph / Ceo@1234  (Veent + JoJo + Sweetleaf)')
		console.log('  Super Admin: admin@veent.ph / Admin@1234')
		console.log('  HR Admin:    hr@veent.ph / Hr@1234')
	})
	.catch(console.error)
	.finally(() => db.$disconnect())
