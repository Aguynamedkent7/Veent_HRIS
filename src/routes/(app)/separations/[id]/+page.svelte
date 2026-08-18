<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { formatShortDate } from '$lib/utils/format'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const s = $derived(data.separation)
	const isFinalized = $derived(s.status === 'FINALIZED')
	const pendingCount = $derived(s.clearanceItems.filter((i) => i.status !== 'CLEARED').length)
	// #297: the reason this actor may not finalize, or null. Computed server-side by the SAME
	// helper the service guard uses, so the button and the refusal cannot disagree.
	const finalizeBar = $derived(data.finalizeBar)

	const peso = (n: number) => n.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })

	// #108: every clearance row is its own form, so each needs its own guard — a shared one would
	// disable the whole checklist while any single row is in flight. Created lazily per item id.
	const clearanceGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const clearanceGuard = (id: string) => (clearanceGuards[id] ??= createSubmitGuard())

	// #108: finalize snapshots final pay and offboards — a second submit must never land.
	// The guard releases `busy` when an inner handler cancels, so the confirm composes normally.
	const finalize = createSubmitGuard((input) => {
		if (
			!confirm(
				'Finalize this separation? This snapshots final pay, offboards the employee, and disables their login. It cannot be undone.'
			)
		)
			input.cancel()
	})

	function statusClass(st: string) {
		if (st === 'FINALIZED') return 'bg-gray-500/15 text-gray-400'
		if (st === 'CLEARED') return 'bg-green-500/15 text-green-400'
		return 'bg-yellow-500/15 text-yellow-400'
	}
</script>

<svelte:head>
	<title>Separation — {s.employee.lastName}, {s.employee.firstName}</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<BackButton fallback="/separations" label="Separations" />
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400"
		>
			{form.error}
		</div>
	{/if}
	{#if form?.finalized}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-600 dark:text-green-400"
		>
			Separation finalized. The employee is now offboarded and their login is disabled.
		</div>
	{/if}

	<!-- Header -->
	<div class="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
		<div>
			<h1 class="text-xl font-bold tracking-tight">
				{s.employee.lastName}, {s.employee.firstName}
			</h1>
			<p class="text-sm text-muted-foreground">
				{s.employee.jobTitle} · {s.employee.department?.name ?? '—'} · #{s.employee.employeeNumber}
			</p>
			<p class="mt-2 text-sm">
				<span class="font-medium">{s.type}</span> · effective {formatShortDate(s.effectiveDate)}
			</p>
			{#if s.reason}<p class="mt-1 text-sm text-muted-foreground">{s.reason}</p>{/if}
		</div>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(s.status)}"
			>{s.status}</span
		>
	</div>

	<!-- Clearance checklist -->
	<div class="rounded-lg border bg-card">
		<div class="border-b px-4 py-3">
			<div class="flex items-center justify-between">
				<h2 class="font-semibold">Clearance checklist</h2>
				<span class="text-xs text-muted-foreground"
					>{s.clearanceItems.length - pendingCount}/{s.clearanceItems.length} cleared</span
				>
			</div>
			{#if !isFinalized}
				<p class="mt-1 text-xs text-amber-600">
					Marking any item cleared here means you will not be able to finalize this case. Another HR
					administrator, or your CEO, will have to finalize it.
				</p>
			{/if}
		</div>
		<ul class="divide-y">
			{#each s.clearanceItems as item (item.id)}
				<li class="flex items-center justify-between gap-3 px-4 py-3">
					<div>
						<p class="text-sm font-medium">{item.label}</p>
						<p class="text-xs text-muted-foreground">{item.department}</p>
					</div>
					{#if isFinalized}
						<span
							class="rounded-full px-2 py-0.5 text-xs font-medium {item.status === 'CLEARED'
								? 'bg-green-500/15 text-green-400'
								: 'bg-yellow-500/15 text-yellow-400'}">{item.status}</span
						>
					{:else}
						{@const toggle = clearanceGuard(item.id)}
						<form method="POST" action="?/toggleClearance" use:enhance={toggle.enhance}>
							<input type="hidden" name="itemId" value={item.id} />
							<input
								type="hidden"
								name="cleared"
								value={item.status === 'CLEARED' ? 'false' : 'true'}
							/>
							<button
								type="submit"
								disabled={toggle.busy}
								class="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50 {item.status ===
								'CLEARED'
									? 'text-green-600 dark:text-green-400'
									: 'text-muted-foreground'}"
							>
								{item.status === 'CLEARED' ? 'Cleared' : 'Mark cleared'}
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</div>

	<!-- Final pay -->
	<div class="rounded-lg border bg-card">
		<div class="border-b px-4 py-3">
			<h2 class="font-semibold">Final pay {isFinalized ? '(settled)' : '(preview)'}</h2>
		</div>
		<dl class="divide-y">
			{#each data.finalPay.lines as line (line.label)}
				<div class="flex items-center justify-between px-4 py-2 text-sm">
					<dt class="text-muted-foreground">{line.label}</dt>
					<dd class="font-mono {line.amount < 0 ? 'text-red-600' : ''}">{peso(line.amount)}</dd>
				</div>
			{/each}
			<div class="flex items-center justify-between px-4 py-3 text-sm font-semibold">
				<dt>Net final pay</dt>
				<dd class="font-mono {data.finalPay.total < 0 ? 'text-red-600' : ''}">
					{peso(data.finalPay.total)}
				</dd>
			</div>
		</dl>
		{#if data.finalPay.total < 0}
			<p class="px-4 pb-3 text-xs text-muted-foreground">
				Negative total means the employee owes the company after offsets.
			</p>
		{/if}
	</div>

	<!-- Finalize -->
	{#if !isFinalized}
		<div class="rounded-lg border border-destructive/30 bg-card p-4">
			<h2 class="font-semibold text-destructive">Finalize separation</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Snapshots the final pay above, sets the employee to <strong>OFFBOARDED</strong> (end date
				{formatShortDate(s.effectiveDate)}), and disables their login. This cannot be undone.
			</p>
			{#if pendingCount > 0}
				<p class="mt-2 text-sm text-amber-600">
					{pendingCount} clearance item{pendingCount === 1 ? '' : 's'} still pending — clear all before
					finalizing.
				</p>
			{/if}
			{#if finalizeBar}
				<p class="mt-2 text-sm text-amber-600">{finalizeBar}</p>
			{/if}
			<form method="POST" action="?/finalize" use:enhance={finalize.enhance} class="mt-3">
				<button
					type="submit"
					disabled={pendingCount > 0 || !!finalizeBar || finalize.busy}
					class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
					>{finalize.busy ? 'Finalizing…' : 'Finalize & offboard'}</button
				>
			</form>
		</div>
	{:else}
		<div class="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
			Finalized{s.finalizedAt ? ` on ${formatShortDate(s.finalizedAt)}` : ''}. Final pay settled at
			<span class="font-mono">{peso(Number(s.finalPayAmount ?? 0))}</span>.
		</div>
	{/if}
</div>
