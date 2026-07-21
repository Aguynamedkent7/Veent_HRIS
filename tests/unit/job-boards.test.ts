import { describe, it, expect } from 'vitest'
import { liveChannels, type BoardChannelView } from '../../src/lib/server/services/job-boards'

const mk = (
	name: string,
	live: boolean,
	status: BoardChannelView['status'] = live ? 'POSTED' : null
): BoardChannelView => ({ boardId: name, name, live, url: null, postedAt: null, status })

describe('liveChannels — the close-the-loop takedown list (#117)', () => {
	it('returns only boards currently POSTED', () => {
		const boards = [
			mk('JobStreet', true),
			mk('Indeed', false),
			mk('LinkedIn', true),
			mk('Facebook', false, 'TAKEN_DOWN')
		]
		expect(liveChannels(boards).map((b) => b.name)).toEqual(['JobStreet', 'LinkedIn'])
	})

	it('is empty when nothing is live (taken down / never posted)', () => {
		expect(liveChannels([mk('Indeed', false), mk('Facebook', false, 'TAKEN_DOWN')])).toEqual([])
	})
})
