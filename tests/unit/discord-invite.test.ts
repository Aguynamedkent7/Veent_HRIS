import { describe, it, expect } from 'vitest'
import { buildDiscordInvite } from '../../src/lib/server/notifications'

// #186 — new hires are emailed an invitation to the company's Discord server.
describe('buildDiscordInvite (#186)', () => {
	const d = { firstName: 'Elena', orgName: 'Veent', inviteUrl: 'https://discord.gg/abc123' }

	it('names the org in the subject', () => {
		expect(buildDiscordInvite(d).subject).toBe('Join the Veent Discord server')
	})

	it('greets the hire and includes the invite link', () => {
		const { body } = buildDiscordInvite(d)
		expect(body).toContain('Hi Elena,')
		expect(body).toContain('Welcome to Veent!')
		expect(body).toContain('https://discord.gg/abc123')
	})
})
