<script lang="ts">
	import { enhance } from '$app/forms'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// #108: double-submitting either config form would write the same rates twice.
	const saveConfig = createSubmitGuard()
	const saveRates = createSubmitGuard()
	const saveStatutory = createSubmitGuard()

	// Editable form fields seeded once from the loaded config — an intentional
	// snapshot so a data refresh can't clobber the user's in-progress edits.
	// svelte-ignore state_referenced_locally
	const cfg = data.config
	let payFrequency = $state(cfg?.payFrequency ?? 'SEMI_MONTHLY')
	let philhealthRate = $state(Number(cfg?.philhealthRate ?? 0.05) * 100)
	let pagibigRate = $state(Number(cfg?.pagibigRate ?? 0.02) * 100)
	let cutoffDay1 = $state(cfg?.firstCutoff ?? 15)
	let cutoffDay2 = $state(cfg?.secondCutoff ?? 30)

	// #220 — Statutory rate tables. Scalars seed from the override only (blank = use the default,
	// shown as the placeholder); rate fields are percentages here to match the section above.
	// svelte-ignore state_referenced_locally
	const stat = data.statutory
	const pctOrEmpty = (v: number | null | undefined) => (v == null ? '' : v * 100)
	let statPhilhealthRate = $state<number | ''>(pctOrEmpty(stat.override?.philhealthRate))
	let statPhilhealthFloor = $state<number | ''>(stat.override?.philhealthFloor ?? '')
	let statPhilhealthCeiling = $state<number | ''>(stat.override?.philhealthCeiling ?? '')
	let statPagibigRate = $state<number | ''>(pctOrEmpty(stat.override?.pagibigRate))
	let statPagibigCap = $state<number | ''>(stat.override?.pagibigCap ?? '')

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
	// Editors prefill from the current EFFECTIVE table (override if set, else the hardcoded default),
	// so HR edits from a real starting point. The checkbox decides whether the table is sent at all.
	let overrideSss = $state(!!stat.override?.sssBrackets)
	let overrideTax = $state(!!stat.override?.taxBrackets)
	let sssRows = $state<SssRow[]>(
		structuredClone(((stat.override?.sssBrackets ?? stat.defaults.sssBrackets) as SssRow[]) ?? [])
	)
	let taxRows = $state<TaxRow[]>(
		structuredClone(((stat.override?.taxBrackets ?? stat.defaults.taxBrackets) as TaxRow[]) ?? [])
	)

	// Hidden-field payloads: '' when the table is not overridden (server reads that as null = default).
	const num = (v: number | null) => (v == null ? 0 : Number(v))
	const nullable = (v: number | null) => (v == null ? null : Number(v))
	const sssPayload = $derived(
		!overrideSss
			? ''
			: JSON.stringify(
					sssRows.map((r, i) => ({
						salaryFloor: num(r.salaryFloor),
						// Last bracket is open-ended → null ceiling.
						salaryCeiling:
							i === sssRows.length - 1 ? nullable(r.salaryCeiling) : num(r.salaryCeiling),
						totalContribution: num(r.totalContribution),
						eeShare: num(r.eeShare),
						erShare: num(r.erShare)
					}))
				)
	)
	const taxPayload = $derived(
		!overrideTax
			? ''
			: JSON.stringify(
					taxRows.map((r, i) => ({
						floor: num(r.floor),
						ceiling: i === taxRows.length - 1 ? nullable(r.ceiling) : num(r.ceiling),
						baseTax: num(r.baseTax),
						rate: num(r.rate),
						excessOver: num(r.excessOver)
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
	const scalarInput =
		'flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>Payroll Configuration — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Payroll Configuration</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Configure payroll frequency, statutory rates, and cutoff dates.
		</p>
	</div>

	{#if form?.success}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-400"
		>
			Payroll configuration saved successfully.
		</div>
	{/if}

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<form
		method="POST"
		action="?/update"
		use:enhance={saveConfig.enhance}
		class="rounded-md border bg-card p-6 space-y-6"
	>
		<!-- Pay Frequency -->
		<div class="space-y-2">
			<label class="text-sm font-medium" for="payFrequency">Pay Frequency</label>
			<select
				id="payFrequency"
				name="payFrequency"
				bind:value={payFrequency}
				class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="SEMI_MONTHLY">Semi-Monthly (twice a month)</option>
				<option value="MONTHLY">Monthly (once a month)</option>
			</select>
		</div>

		<!-- Statutory Rates -->
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-medium" for="philhealthRate"> PhilHealth Rate (%) </label>
				<div class="relative">
					<input
						id="philhealthRate"
						name="philhealthRate"
						type="number"
						min="0"
						max="100"
						step="0.05"
						bind:value={philhealthRate}
						class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-8"
					/>
					<span
						class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
						>%</span
					>
				</div>
				<p class="text-xs text-muted-foreground">Current statutory rate: 5%</p>
			</div>

			<div class="space-y-2">
				<label class="text-sm font-medium" for="pagibigRate"> Pag-IBIG Rate (%) </label>
				<div class="relative">
					<input
						id="pagibigRate"
						name="pagibigRate"
						type="number"
						min="0"
						max="100"
						step="0.05"
						bind:value={pagibigRate}
						class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pr-8"
					/>
					<span
						class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
						>%</span
					>
				</div>
				<p class="text-xs text-muted-foreground">Standard employee contribution: 2%</p>
			</div>
		</div>

		<!-- Cutoff Days (only shown for SEMI_MONTHLY) -->
		{#if payFrequency === 'SEMI_MONTHLY'}
			<div class="rounded-md border bg-muted/50 p-4 space-y-4">
				<h3 class="text-sm font-semibold">Semi-Monthly Cutoff Days</h3>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<label class="text-sm font-medium" for="cutoffDay1">Cutoff Day 1</label>
						<input
							id="cutoffDay1"
							name="cutoffDay1"
							type="number"
							min="1"
							max="28"
							bind:value={cutoffDay1}
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<p class="text-xs text-muted-foreground">Day of month for first payroll cutoff</p>
					</div>
					<div class="space-y-2">
						<label class="text-sm font-medium" for="cutoffDay2">Cutoff Day 2</label>
						<input
							id="cutoffDay2"
							name="cutoffDay2"
							type="number"
							min="1"
							max="31"
							bind:value={cutoffDay2}
							class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<p class="text-xs text-muted-foreground">Day of month for second payroll cutoff</p>
					</div>
				</div>
			</div>
		{/if}

		<div class="flex justify-end pt-2">
			<button
				type="submit"
				disabled={saveConfig.busy}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
			>
				{saveConfig.busy ? 'Saving…' : 'Save Configuration'}
			</button>
		</div>
	</form>

	<!-- Premium pay multipliers (PayRateRule) -->
	<form
		method="POST"
		action="?/updateRates"
		use:enhance={saveRates.enhance}
		class="rounded-md border bg-card p-6 space-y-6"
	>
		<div>
			<h2 class="text-lg font-semibold">Premium Pay Multipliers</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Applied against the base hourly rate when payroll auto-computes OT, night differential,
				rest-day, and holiday pay. Night differential is an additive fraction (e.g. 0.10 = +10%);
				the others are full multipliers (e.g. 2.00 = 200%). Defaults follow DOLE rules.
			</p>
		</div>

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each [{ name: 'overtime', label: 'Overtime', hint: 'ordinary-day OT (×)' }, { name: 'overtimePremium', label: 'OT premium (rest/holiday)', hint: 'extra factor on premium-day OT' }, { name: 'nightDiff', label: 'Night differential', hint: '10pm–6am, additive' }, { name: 'restDay', label: 'Rest day', hint: 'rest-day work (×)' }, { name: 'regularHoliday', label: 'Regular holiday', hint: '(×)' }, { name: 'specialHoliday', label: 'Special holiday', hint: '(×)' }] as f (f.name)}
				<div>
					<label for="rate-{f.name}" class="text-sm font-medium">{f.label}</label>
					<input
						id="rate-{f.name}"
						name={f.name}
						type="number"
						min="0"
						max="10"
						step="0.01"
						required
						value={data.rates[f.name as keyof typeof data.rates]}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<p class="mt-1 text-xs text-muted-foreground">{f.hint}</p>
				</div>
			{/each}
		</div>

		<div class="flex justify-end">
			<button
				type="submit"
				disabled={saveRates.busy}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
			>
				{saveRates.busy ? 'Saving…' : 'Save Multipliers'}
			</button>
		</div>
	</form>

	<!-- Statutory rate tables (#220): overrides the hardcoded PH defaults the payroll engine uses. -->
	<form
		method="POST"
		action="?/updateStatutoryRates"
		use:enhance={saveStatutory.enhance}
		class="rounded-md border bg-card p-6 space-y-6"
	>
		<div>
			<h2 class="text-lg font-semibold">Statutory Rate Tables</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Overrides the SSS, PhilHealth, Pag-IBIG, and BIR withholding-tax figures the payroll engine
				computes with — for when a law amendment changes the rates. Leave a scalar blank to keep the
				national default; a bracket table applies only when its checkbox is ticked. Approved payroll
				runs are frozen, so edits affect only in-progress runs.
			</p>
		</div>

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
					placeholder={String(stat.defaults.philhealthRate * 100)}
					bind:value={statPhilhealthRate}
					class={scalarInput}
				/>
				<p class="text-xs text-muted-foreground">Default {stat.defaults.philhealthRate * 100}%</p>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-ph-floor">PhilHealth salary floor (₱)</label>
				<input
					id="stat-ph-floor"
					name="philhealthFloor"
					type="number"
					min="0"
					step="0.01"
					placeholder={String(stat.defaults.philhealthFloor)}
					bind:value={statPhilhealthFloor}
					class={scalarInput}
				/>
				<p class="text-xs text-muted-foreground">Default ₱{stat.defaults.philhealthFloor}</p>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-ph-ceil">PhilHealth salary ceiling (₱)</label>
				<input
					id="stat-ph-ceil"
					name="philhealthCeiling"
					type="number"
					min="0"
					step="0.01"
					placeholder={String(stat.defaults.philhealthCeiling)}
					bind:value={statPhilhealthCeiling}
					class={scalarInput}
				/>
				<p class="text-xs text-muted-foreground">Default ₱{stat.defaults.philhealthCeiling}</p>
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
					placeholder={String(stat.defaults.pagibigRate * 100)}
					bind:value={statPagibigRate}
					class={scalarInput}
				/>
				<p class="text-xs text-muted-foreground">Default {stat.defaults.pagibigRate * 100}%</p>
			</div>
			<div class="space-y-1">
				<label class="text-sm font-medium" for="stat-pi-cap">Pag-IBIG EE cap (₱)</label>
				<input
					id="stat-pi-cap"
					name="pagibigCap"
					type="number"
					min="0"
					step="0.01"
					placeholder={String(stat.defaults.pagibigCap)}
					bind:value={statPagibigCap}
					class={scalarInput}
				/>
				<p class="text-xs text-muted-foreground">Default ₱{stat.defaults.pagibigCap}</p>
			</div>
		</div>

		<!-- SSS contribution table -->
		<div class="rounded-md border bg-muted/30 p-4 space-y-3">
			<label class="flex items-center gap-2 text-sm font-semibold">
				<input type="checkbox" bind:checked={overrideSss} class="h-4 w-4 rounded border-input" />
				Override SSS contribution table
			</label>
			{#if overrideSss}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs text-muted-foreground">
								<th class="p-1 font-medium">Salary floor</th>
								<th class="p-1 font-medium">Salary ceiling</th>
								<th class="p-1 font-medium">Total</th>
								<th class="p-1 font-medium">EE share</th>
								<th class="p-1 font-medium">ER share</th>
								<th class="p-1"></th>
							</tr>
						</thead>
						<tbody>
							{#each sssRows as row, i (i)}
								<tr>
									<td class="p-1"
										><input
											type="number"
											step="0.01"
											bind:value={row.salaryFloor}
											class={cell}
										/></td
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
									<td class="p-1"
										><input
											type="number"
											step="0.01"
											bind:value={row.totalContribution}
											class={cell}
										/></td
									>
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
					Rows must be sorted ascending, non-overlapping, start at 0, and the last ceiling left
					blank (open-ended).
				</p>
			{/if}
		</div>

		<!-- BIR withholding tax table -->
		<div class="rounded-md border bg-muted/30 p-4 space-y-3">
			<label class="flex items-center gap-2 text-sm font-semibold">
				<input type="checkbox" bind:checked={overrideTax} class="h-4 w-4 rounded border-input" />
				Override BIR withholding-tax table
			</label>
			{#if overrideTax}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs text-muted-foreground">
								<th class="p-1 font-medium">Income floor</th>
								<th class="p-1 font-medium">Income ceiling</th>
								<th class="p-1 font-medium">Base tax</th>
								<th class="p-1 font-medium">Rate (0–1)</th>
								<th class="p-1 font-medium">Excess over</th>
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
									<td class="p-1"
										><input type="number" step="0.01" bind:value={row.baseTax} class={cell} /></td
									>
									<td class="p-1"
										><input
											type="number"
											step="0.0001"
											min="0"
											max="1"
											bind:value={row.rate}
											class={cell}
										/></td
									>
									<td class="p-1"
										><input
											type="number"
											step="0.01"
											bind:value={row.excessOver}
											class={cell}
										/></td
									>
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
					non-overlapping, start at 0, last ceiling blank; rate is a fraction (0.20 = 20%).
				</p>
			{/if}
		</div>

		<input type="hidden" name="sssBrackets" value={sssPayload} />
		<input type="hidden" name="taxBrackets" value={taxPayload} />

		<div class="flex justify-end">
			<button
				type="submit"
				disabled={saveStatutory.busy}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
			>
				{saveStatutory.busy ? 'Saving…' : 'Save Statutory Rates'}
			</button>
		</div>
	</form>
</div>
