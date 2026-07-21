<script lang="ts">
	import {
		periodOf,
		formatPeriodPreview,
		toPeriodInputValue,
		type PeriodKind
	} from '$lib/utils/pay-periods'

	// Standard pay-period picker (#129): a month + year select and a segmented
	// First-half / Second-half / Whole-month control that together resolve to one of the
	// three standard shapes. It emits the resolved bounds as hidden inputs (default names
	// periodStart/periodEnd, overridable for forms that post start/end), so the surrounding
	// <form> submits exactly the same field names it did with the old date inputs — the
	// service layer still validates, this just constrains what a user can pick.
	let {
		startName = 'periodStart',
		endName = 'periodEnd',
		year = $bindable(),
		month0 = $bindable(),
		kind = $bindable('FIRST_HALF')
	}: {
		startName?: string
		endName?: string
		year?: number
		month0?: number
		kind?: PeriodKind
	} = $props()

	// Default to the current PHT month when the parent didn't seed a value.
	const now = new Date()
	if (year === undefined) year = now.getFullYear()
	if (month0 === undefined) month0 = now.getMonth()

	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	]
	// A small window around the current year covers routine runs and back-dated corrections.
	const YEARS = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

	const KIND_OPTIONS: { value: PeriodKind; label: string }[] = [
		{ value: 'FIRST_HALF', label: 'First half (1–15)' },
		{ value: 'SECOND_HALF', label: 'Second half (16–EOM)' },
		{ value: 'WHOLE_MONTH', label: 'Whole month' }
	]

	const period = $derived(periodOf(kind as PeriodKind, year as number, month0 as number))
	const startValue = $derived(toPeriodInputValue(period.periodStart))
	const endValue = $derived(toPeriodInputValue(period.periodEnd))
	const preview = $derived(formatPeriodPreview(period.periodStart, period.periodEnd))

	const selectClass =
		'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<!-- Resolved bounds travel with the form; the controls below are UI only. -->
<input type="hidden" name={startName} value={startValue} />
<input type="hidden" name={endName} value={endValue} />

<div class="space-y-3">
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<label for="pp-month" class="text-sm font-medium">Month</label>
			<select id="pp-month" bind:value={month0} class={selectClass}>
				{#each MONTHS as name, i (name)}
					<option value={i}>{name}</option>
				{/each}
			</select>
		</div>
		<div class="space-y-1.5">
			<label for="pp-year" class="text-sm font-medium">Year</label>
			<select id="pp-year" bind:value={year} class={selectClass}>
				{#each YEARS as y (y)}
					<option value={y}>{y}</option>
				{/each}
			</select>
		</div>
	</div>

	<div class="space-y-1.5">
		<span class="text-sm font-medium">Period</span>
		<div class="inline-flex flex-wrap gap-1 rounded-md border bg-muted/40 p-1" role="group">
			{#each KIND_OPTIONS as opt (opt.value)}
				<button
					type="button"
					onclick={() => (kind = opt.value)}
					aria-pressed={kind === opt.value}
					class="rounded px-3 py-1.5 text-sm font-medium transition-colors {kind === opt.value
						? 'bg-primary text-primary-foreground'
						: 'hover:bg-accent'}"
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>

	<p class="text-sm text-muted-foreground">{preview}</p>
</div>
