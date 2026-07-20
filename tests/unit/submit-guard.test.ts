import { describe, it, expect, vi } from 'vitest'
import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'

/**
 * #108 — the double-submit guard is load-bearing across ~90 forms, so its state machine is
 * pinned here. The critical property is that `busy` is ALWAYS released: a latched guard wedges
 * its form for the life of the page, which is a worse failure than the duplicate it prevents.
 */

/**
 * Drive one full submit cycle: call enhance, then run whatever callback it returned.
 *
 * `cancelled` is tracked via a spy captured BEFORE the call, because the guard deliberately
 * swaps `input.cancel` for its own wrapper — reading `input.cancel` afterwards would inspect
 * the wrapper, not the original.
 */
async function submit(guard: ReturnType<typeof createSubmitGuard>) {
	const cancelled = vi.fn()
	const input = {
		cancel: cancelled,
		formData: new FormData(),
		action: new URL('http://x/?/a'),
		submitter: null
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const after = await guard.enhance(input as any)
	return {
		cancelled,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		settle: async (opts: any = { update: vi.fn() }) => {
			if (after) await (after as (o: unknown) => Promise<void>)(opts)
			return opts
		},
		returnedCallback: after
	}
}

describe('createSubmitGuard', () => {
	it('is idle before any submit', () => {
		expect(createSubmitGuard().busy).toBe(false)
	})

	it('is busy while in flight and idle again after the response settles', async () => {
		const g = createSubmitGuard()
		const s = await submit(g)
		expect(g.busy).toBe(true)
		await s.settle()
		expect(g.busy).toBe(false)
	})

	it('cancels a second submit that arrives while one is in flight', async () => {
		const g = createSubmitGuard()
		const first = await submit(g)

		const second = await submit(g)
		expect(second.cancelled).toHaveBeenCalledOnce()
		expect(second.returnedCallback).toBeUndefined() // dropped, not queued

		// The first is unaffected and still completes normally.
		await first.settle()
		expect(g.busy).toBe(false)
	})

	it('accepts a new submit once the previous one has settled', async () => {
		const g = createSubmitGuard()
		await (await submit(g)).settle()
		const again = await submit(g)
		expect(again.cancelled).not.toHaveBeenCalled()
		expect(g.busy).toBe(true)
	})

	it('calls update() by default when the wrapped handler returns nothing', async () => {
		const g = createSubmitGuard()
		const opts = await (await submit(g)).settle()
		expect(opts.update).toHaveBeenCalledOnce()
	})

	it("defers to the wrapped handler's callback instead of calling update() itself", async () => {
		const ownCallback = vi.fn()
		const g = createSubmitGuard(() => ownCallback)
		const opts = await (await submit(g)).settle()
		expect(ownCallback).toHaveBeenCalledOnce()
		expect(opts.update).not.toHaveBeenCalled() // the handler owns the response
		expect(g.busy).toBe(false)
	})

	it('releases busy when the wrapped handler cancels (declined confirm)', async () => {
		// The regression this test exists for: `busy` used to latch on forever here, wedging the
		// form permanently the first time a user clicked "cancel" on a confirm dialog.
		const g = createSubmitGuard((input) => input.cancel())
		const s = await submit(g)

		expect(s.cancelled).toHaveBeenCalledOnce()
		expect(s.returnedCallback).toBeUndefined()
		expect(g.busy).toBe(false)

		// ...and the form still works afterwards.
		const next = await submit(createSubmitGuard())
		expect(next.cancelled).not.toHaveBeenCalled()
	})

	it('releases busy when the wrapped handler throws', async () => {
		const g = createSubmitGuard(() => {
			throw new Error('validation blew up')
		})
		await expect(submit(g)).rejects.toThrow('validation blew up')
		expect(g.busy).toBe(false)
	})

	it('releases busy even when the response callback throws', async () => {
		const g = createSubmitGuard()
		const s = await submit(g)
		await expect(
			s.settle({
				update: () => {
					throw new Error('update failed')
				}
			})
		).rejects.toThrow('update failed')
		expect(g.busy).toBe(false)
	})

	it('keeps separate forms independent', async () => {
		const a = createSubmitGuard()
		const b = createSubmitGuard()
		await submit(a)
		expect(a.busy).toBe(true)
		expect(b.busy).toBe(false) // a per-row guard must not freeze its siblings
	})
})
