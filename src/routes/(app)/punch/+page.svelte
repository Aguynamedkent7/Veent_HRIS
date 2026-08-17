<script lang="ts">
	import { onMount, tick } from 'svelte'
	import { enhance } from '$app/forms'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// #108: punching writes a row — a double-tap must not write two.
	const punch = createSubmitGuard()

	// Whether the click handler below is live yet. Until it is, a click submits the form the way
	// the browser always would — a punch with no location, which is a supported outcome, not a
	// failure. Surfaced as `data-ready` because it is a real, observable difference in what a
	// click does, and the e2e spec has to wait for it before asserting on a captured location.
	let ready = $state(false)
	onMount(() => {
		ready = true
	})

	/**
	 * #177 — the four geolocation outcomes, as four NAMED states.
	 *
	 * They are deliberately separate branches rather than conditions woven through the markup:
	 * each one is reached by exactly one named function below, each one's copy lives in exactly
	 * one place (LOCATION_COPY), and the markup reads the state instead of re-deriving it. A
	 * later UX pass can change what any state RENDERS without rewiring how it is REACHED.
	 *
	 *  idle        — nothing asked for yet (initial state)
	 *  granted     — permission granted and a usable fix arrived
	 *  denied      — the user (or a policy) refused the permission
	 *  nofix       — permission was not the problem: timeout, position unavailable, or a browser
	 *                that never called back at all (the watchdog)
	 *  unsupported — navigator.geolocation does not exist: an insecure origin (plain http) or an
	 *                old browser. Not an error the employee can fix, and not their problem.
	 *
	 * Every non-`granted` state still punches. A location failure must never cost the employee
	 * their punch — that is the rule the whole flow is built around.
	 */
	type LocationState = 'idle' | 'granted' | 'denied' | 'nofix' | 'unsupported'

	let locationState = $state<LocationState>('idle')
	let accuracyM = $state<number | null>(null)

	// Every state's copy, in one place. A UX pass edits this table and nothing else.
	const locationCopy: Record<LocationState, string> = $derived({
		idle: 'Location has not been requested yet.',
		// Never a bare coordinate pair: an accuracy figure always rides along, and when the device
		// does not report one we say so rather than implying the reading is exact.
		granted:
			accuracyM === null
				? 'Location captured (accuracy unknown).'
				: `Location captured (±${accuracyM} m).`,
		denied: 'Location permission denied — punching without it.',
		nofix: 'Could not get a location in time — punching without it.',
		unsupported: 'Location is not available on this device or connection — punching without it.'
	})
	const locationMessage = $derived(locationCopy[locationState])

	// Hidden fields. Empty string = "no reading"; the server discards anything unparseable and
	// records the punch regardless, so an empty field is never an error.
	let punchType = $state('')
	let latitude = $state('')
	let longitude = $state('')
	let accuracyField = $state('')

	// The API's own timeout is 8 s. This watchdog is deliberately LONGER, so the normal
	// no-fix path is the API's error callback and this only catches a browser that never
	// calls back at all.
	const WATCHDOG_MS = 9000
	const GEOLOCATION_TIMEOUT_MS = 8000

	let formEl: HTMLFormElement

	function clearReading() {
		latitude = ''
		longitude = ''
		accuracyField = ''
		accuracyM = null
	}

	/**
	 * Ask for a position, then submit — whatever the answer. `settled` makes the submit
	 * happen exactly once no matter which branch gets there first.
	 */
	function requestLocationThenPunch(type: 'IN' | 'OUT') {
		punchType = type
		clearReading()
		let settled = false

		const settle = async (state: LocationState) => {
			if (settled) return
			settled = true
			locationState = state
			// Svelte flushes state into the DOM on the NEXT tick, so the hidden inputs still hold
			// their old (empty) values at this point. Submitting now would serialise those and the
			// reading we just captured would be silently lost — the punch would land, with no
			// location, and nothing would say why. Wait for the flush first.
			await tick()
			formEl.requestSubmit()
		}

		// Branch 4 — the API is absent entirely (insecure origin or an old browser).
		if (!('geolocation' in navigator)) {
			settle('unsupported')
			return
		}

		// Branch 3a — nothing came back at all.
		setTimeout(() => settle('nofix'), WATCHDOG_MS)

		navigator.geolocation.getCurrentPosition(
			// Branch 1 — permission granted, usable fix.
			(position) => {
				latitude = String(position.coords.latitude)
				longitude = String(position.coords.longitude)
				accuracyM =
					typeof position.coords.accuracy === 'number' && Number.isFinite(position.coords.accuracy)
						? Math.round(position.coords.accuracy)
						: null
				accuracyField = accuracyM === null ? '' : String(accuracyM)
				settle('granted')
			},
			// Branch 2 — refused; Branch 3b — timeout or no fix available.
			(err) => {
				clearReading()
				settle(err.code === err.PERMISSION_DENIED ? 'denied' : 'nofix')
			},
			{ enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 }
		)
	}

	// Intercepts the click so the location request can run first. Without JavaScript this handler
	// never runs, the browser submits the form natively, and the punch is recorded with no
	// location — which is a supported outcome, not a failure.
	function onPunchClick(event: MouseEvent, type: 'IN' | 'OUT') {
		if (punch.busy) return
		event.preventDefault()
		requestLocationThenPunch(type)
	}

	const coordinates = (p: { latitude: number | null; longitude: number | null }) =>
		p.latitude === null || p.longitude === null
			? null
			: `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
</script>

<svelte:head><title>Punch — Veent HRIS</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6 p-4">
	<div>
		<h1 class="text-2xl font-semibold">Punch</h1>
		<p class="text-sm text-muted-foreground">{data.employeeName}</p>
	</div>

	<form
		method="POST"
		action="?/punch"
		use:enhance={punch.enhance}
		bind:this={formEl}
		data-ready={ready}
		class="space-y-4 rounded-lg border border-border bg-card p-4"
	>
		<!-- Set by the click handler before requestSubmit(). Placed BEFORE the buttons so that in
		     the no-JavaScript case the submitting button's own value comes later in the form and
		     wins. -->
		<input type="hidden" name="punchType" bind:value={punchType} />
		<input type="hidden" name="latitude" bind:value={latitude} />
		<input type="hidden" name="longitude" bind:value={longitude} />
		<input type="hidden" name="accuracyM" bind:value={accuracyField} />

		<div class="flex gap-3">
			<button
				type="submit"
				name="punchType"
				value="IN"
				disabled={punch.busy}
				onclick={(e) => onPunchClick(e, 'IN')}
				class="flex-1 rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground disabled:opacity-50"
			>
				Punch In
			</button>
			<button
				type="submit"
				name="punchType"
				value="OUT"
				disabled={punch.busy}
				onclick={(e) => onPunchClick(e, 'OUT')}
				class="flex-1 rounded-md border border-border px-4 py-3 font-medium disabled:opacity-50"
			>
				Punch Out
			</button>
		</div>

		<!-- One live region for both the location state and the punch outcome, so a screen reader
		     hears the sequence in the order it happens. -->
		<div role="status" aria-live="polite" class="space-y-1 text-sm">
			<p class="text-muted-foreground">{locationMessage}</p>
			{#if form?.punched}
				<p class="font-medium text-foreground">
					Punched {form.punched === 'IN' ? 'in' : 'out'}{form.hadLocation
						? ' with your location.'
						: ' without a location.'}
				</p>
			{:else if form?.error}
				<p class="font-medium text-destructive">{form.error}</p>
			{/if}
		</div>
	</form>

	<section class="space-y-2">
		<h2 class="text-lg font-medium">Your last {data.historyDays} days</h2>
		{#if data.punches.length === 0}
			<p class="text-sm text-muted-foreground">No punches recorded in this window.</p>
		{:else}
			<ul class="divide-y divide-border rounded-lg border border-border">
				{#each data.punches as p (p.id)}
					{@const coords = coordinates(p)}
					<li class="flex flex-wrap items-baseline justify-between gap-2 p-3 text-sm">
						<span class="font-medium">{p.punchType === 'IN' ? 'Clock in' : 'Clock out'}</span>
						<span class="text-muted-foreground">{p.at}</span>
						<span class="w-full text-xs text-muted-foreground">
							{#if coords}
								<!-- An accuracy qualifier ALWAYS accompanies the coordinates — a reading is
								     never presented as if it were exact. -->
								{coords}
								{p.locationAccuracyM === null
									? '(accuracy unknown)'
									: `(±${Math.round(p.locationAccuracyM)} m)`}
							{:else}
								No location recorded
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
