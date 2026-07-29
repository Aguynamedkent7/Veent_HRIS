<script lang="ts">
	import { enhance } from '$app/forms'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const saveGuard = createSubmitGuard()
	let formEl = $state<HTMLFormElement>()
	let confirmOpen = $state(false)

	// Prefill from the live authoritative config (#220). Rate fields are percentages in the UI.
	// Round the ×100 to kill float noise (0.3 * 100 === 30.000000000000004); clean values round-trip.
	const toPct = (d: number) => Math.round(d * 1e6) / 1e4
	// svelte-ignore state_referenced_locally
	const live = data.live
	let philhealthRate = $state(toPct(live.philhealthRate))
	let philhealthFloor = $state(live.philhealthFloor)
	let philhealthCeiling = $state(live.philhealthCeiling)
	let pagibigRate = $state(toPct(live.pagibigRate))
	let pagibigCap = $state(live.pagibigCap)

	type SssRow = {
		salaryFloor: number | null
		salaryCeiling: number | null
		totalContribution: number | null
		eeShare: number | null
		erShare: number | null
	}
	type TaxRow = {
		floor: number | null
		ceiling: number | null
		baseTax: number | null
		rate: number | null
		excessOver: number | null
	}
	let sssRows = $state<SssRow[]>(structuredClone(live.sssBrackets as SssRow[]))
	// Rate is shown/entered as a percentage in the UI (0.25 → 25); the server converts back on save.
	let taxRows = $state<TaxRow[]>(
		(live.taxBrackets as TaxRow[]).map((r) => ({
			...r,
			rate: r.rate == null ? null : toPct(r.rate)
		}))
	)

	const num = (v: number | null) => (v == null ? 0 : Number(v))
	const nullable = (v: number | null) => (v == null ? null : Number(v))
	// Read-only previews of the columns the server derives on save (SSS total = ee+er; tax baseTax
	// accumulates across brackets, excessOver = floor). Shown for transparency, never submitted.
	const peso = (v: number) => Math.round(v * 100) / 100
	const sssTotal = (r: SssRow) => peso(num(r.eeShare) + num(r.erShare))
	const taxDerived = $derived.by(() => {
		let baseTax = 0
		return taxRows.map((r, i) => {
			const floor = num(r.floor)
			if (i > 0) baseTax += (floor - num(taxRows[i - 1].floor)) * (num(taxRows[i - 1].rate) / 100)
			return { baseTax: peso(baseTax), excessOver: floor }
		})
	})
	// Only ranges + rates are sent; the server derives the read-only columns. The last bracket is
	// open-ended (null ceiling); the resolver revives that to Infinity.
	const sssPayload = $derived(
		JSON.stringify(
			sssRows.map((r, i) => ({
				salaryFloor: num(r.salaryFloor),
				salaryCeiling: i === sssRows.length - 1 ? nullable(r.salaryCeiling) : num(r.salaryCeiling),
				eeShare: num(r.eeShare),
				erShare: num(r.erShare)
			}))
		)
	)
	const taxPayload = $derived(
		JSON.stringify(
			taxRows.map((r, i) => ({
				floor: num(r.floor),
				ceiling: i === taxRows.length - 1 ? nullable(r.ceiling) : num(r.ceiling),
				rate: num(r.rate)
			}))
		)
	)

	const addSssRow = () =>
		(sssRows = [
			...sssRows,
			{
				salaryFloor: null,
				salaryCeiling: null,
				totalContribution: null,
				eeShare: null,
				erShare: null
			}
		])
	const addTaxRow = () =>
		(taxRows = [
			...taxRows,
			{ floor: null, ceiling: null, baseTax: null, rate: null, excessOver: null }
		])
	const removeSssRow = (i: number) => (sssRows = sssRows.filter((_, idx) => idx !== i))
	const removeTaxRow = (i: number) => (taxRows = taxRows.filter((_, idx) => idx !== i))

	const cell =
		'h-8 w-full rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
	// Read-only derived columns: same box as an input, but muted + non-interactive so it reads as a
	// disabled field, not floating text.
	const roCell =
		'flex h-8 w-full cursor-not-allowed items-center rounded border border-input bg-background px-2 text-sm text-muted-foreground'
	const scalarInput =
		'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

	// Direct save (managers) opens the confirm dialog; the proposer path submits straight away.
	// Capability is fixed for the page's lifetime, so the initial value is exactly what we want.
	// svelte-ignore state_referenced_locally
	const saveAction = data.canManage ? '?/saveStatutoryRates' : '?/proposeStatutoryRates'
</script>

<svelte:head>
	<title>Statutory Rates — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Statutory Rates</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			The SSS, PhilHealth, Pag-IBIG, and BIR withholding-tax figures the payroll engine computes
			with. These are authoritative — changes take effect on the next payroll computation (approved
			runs stay frozen).
			{#if data.canManage}
				You can edit and apply these directly.
			{:else}
				Your changes are submitted for CEO approval before they take effect.
			{/if}
		</p>
	</div>

	{#if form?.success}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-400"
		>
			{form.success}
		</div>
	{/if}
	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<!-- Pending proposals (confirmers only) -->
	{#if data.canManage && data.pending.length > 0}
		<div class="rounded-md border bg-card p-6 space-y-4">
			<h2 class="text-lg font-semibold">Pending proposals</h2>
			<div class="space-y-3">
				{#each data.pending as p (p.id)}
					<div class="rounded-md border bg-muted/30 p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="text-sm">
								<p class="font-medium">Proposed by {p.proposer}</p>
								<p class="text-xs text-muted-foreground">
									{new Date(p.createdAt).toLocaleString()}
								</p>
								<ul class="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
									{#each p.changes as c (c)}
										<li>{c}</li>
									{/each}
								</ul>
							</div>
							<div class="flex shrink-0 gap-2">
								<form method="POST" action="?/confirmProposal" use:enhance>
									<input type="hidden" name="proposalId" value={p.id} />
									<button
										type="submit"
										class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
										>Confirm</button
									>
								</form>
								<form method="POST" action="?/rejectProposal" use:enhance>
									<input type="hidden" name="proposalId" value={p.id} />
									<button
										type="submit"
										class="rounded-md border px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
										>Reject</button
									>
								</form>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Rate editor -->
	<form
		bind:this={formEl}
		method="POST"
		action={saveAction}
		use:enhance={saveGuard.enhance}
		class="rounded-md border bg-card p-6 space-y-6"
	>
		<!-- PhilHealth / Pag-IBIG scalars -->
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-ph-rate">PhilHealth rate (%)</label>
				<input
					id="stat-ph-rate"
					name="philhealthRate"
					type="number"
					min="0"
					max="100"
					step="0.01"
					bind:value={philhealthRate}
					class={scalarInput}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-ph-floor">PhilHealth salary floor (₱)</label>
				<input
					id="stat-ph-floor"
					name="philhealthFloor"
					type="number"
					min="0"
					step="0.01"
					bind:value={philhealthFloor}
					class={scalarInput}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-ph-ceil">PhilHealth salary ceiling (₱)</label>
				<input
					id="stat-ph-ceil"
					name="philhealthCeiling"
					type="number"
					min="0"
					step="0.01"
					bind:value={philhealthCeiling}
					class={scalarInput}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-pi-rate">Pag-IBIG rate (%)</label>
				<input
					id="stat-pi-rate"
					name="pagibigRate"
					type="number"
					min="0"
					max="100"
					step="0.01"
					bind:value={pagibigRate}
					class={scalarInput}
				/>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-pi-cap">Pag-IBIG EE cap (₱)</label>
				<input
					id="stat-pi-cap"
					name="pagibigCap"
					type="number"
					min="0"
					step="0.01"
					bind:value={pagibigCap}
					class={scalarInput}
				/>
			</div>
		</div>

		<!-- SSS contribution table -->
		<div class="rounded-md border bg-muted/30 p-4 space-y-3">
			<h3 class="text-sm font-semibold">SSS contribution table</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-xs text-muted-foreground">
							<th class="p-1 font-medium">Salary floor</th>
							<th class="p-1 font-medium">Salary ceiling</th>
							<th class="p-1 font-medium">Total (auto)</th>
							<th class="p-1 font-medium">EE share</th>
							<th class="p-1 font-medium">ER share</th>
							<th class="p-1"></th>
						</tr>
					</thead>
					<tbody>
						{#each sssRows as row, i (i)}
							<tr>
								<td class="p-1"
									><input type="number" step="0.01" bind:value={row.salaryFloor} class={cell} /></td
								>
								<td class="p-1">
									<input
										type="number"
										step="0.01"
										bind:value={row.salaryCeiling}
										placeholder={i === sssRows.length - 1 ? '∞ (open-ended)' : ''}
										class={cell}
									/>
								</td>
								<td class="p-1"><div class={roCell}>{sssTotal(row)}</div></td>
								<td class="p-1"
									><input type="number" step="0.01" bind:value={row.eeShare} class={cell} /></td
								>
								<td class="p-1"
									><input type="number" step="0.01" bind:value={row.erShare} class={cell} /></td
								>
								<td class="p-1">
									<button
										type="button"
										onclick={() => removeSssRow(i)}
										class="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
										>Remove</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<button
				type="button"
				onclick={addSssRow}
				class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">+ Add row</button
			>
			<p class="text-xs text-muted-foreground">
				Rows must be sorted ascending, non-overlapping, start at 0, and the last ceiling left blank
				(open-ended). Total is derived from EE + ER shares on save.
			</p>
		</div>

		<!-- BIR withholding tax table -->
		<div class="rounded-md border bg-muted/30 p-4 space-y-3">
			<h3 class="text-sm font-semibold">BIR withholding-tax table</h3>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-xs text-muted-foreground">
							<th class="p-1 font-medium">Income floor</th>
							<th class="p-1 font-medium">Income ceiling</th>
							<th class="p-1 font-medium">Base tax (auto)</th>
							<th class="p-1 font-medium">Rate (%)</th>
							<th class="p-1 font-medium">Excess over (auto)</th>
							<th class="p-1"></th>
						</tr>
					</thead>
					<tbody>
						{#each taxRows as row, i (i)}
							<tr>
								<td class="p-1"
									><input type="number" step="0.01" bind:value={row.floor} class={cell} /></td
								>
								<td class="p-1">
									<input
										type="number"
										step="0.01"
										bind:value={row.ceiling}
										placeholder={i === taxRows.length - 1 ? '∞ (open-ended)' : ''}
										class={cell}
									/>
								</td>
								<td class="p-1"><div class={roCell}>{taxDerived[i].baseTax}</div></td>
								<td class="p-1"
									><input
										type="number"
										step="0.01"
										min="0"
										max="100"
										bind:value={row.rate}
										class={cell}
									/></td
								>
								<td class="p-1"><div class={roCell}>{taxDerived[i].excessOver}</div></td>
								<td class="p-1">
									<button
										type="button"
										onclick={() => removeTaxRow(i)}
										class="rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
										>Remove</button
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<button
				type="button"
				onclick={addTaxRow}
				class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">+ Add row</button
			>
			<p class="text-xs text-muted-foreground">
				The first row's ceiling is the ₱-exempt threshold (rate 0). Rows sorted ascending,
				non-overlapping, start at 0, last ceiling blank; rate is a percentage (20 = 20%). Base tax
				and excess-over are derived from the ranges and rates on save.
			</p>
		</div>

		<input type="hidden" name="sssBrackets" value={sssPayload} />
		<input type="hidden" name="taxBrackets" value={taxPayload} />

		<div class="flex justify-end">
			{#if data.canManage}
				<button
					type="button"
					disabled={saveGuard.busy}
					onclick={() => (confirmOpen = true)}
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>
					{saveGuard.busy ? 'Saving…' : 'Save changes'}
				</button>
			{:else}
				<button
					type="submit"
					disabled={saveGuard.busy}
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>
					{saveGuard.busy ? 'Submitting…' : 'Submit for CEO approval'}
				</button>
			{/if}
		</div>
	</form>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Apply statutory rates?"
	message="These rates feed the payroll tax computation for all future runs. Apply them now?"
	confirmText="Apply"
	onconfirm={() => formEl?.requestSubmit()}
/>
