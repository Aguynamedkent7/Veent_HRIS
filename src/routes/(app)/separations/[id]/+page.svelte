<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const s = $derived(data.separation)
	const isFinalized = $derived(s.status === 'FINALIZED')
	const pendingCount = $derived(s.clearanceItems.filter((i) => i.status !== 'CLEARED').length)

	const peso = (n: number) => n.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })

	function statusClass(st: string) {
		if (st === 'FINALIZED') return 'bg-gray-100 text-gray-600'
		if (st === 'CLEARED') return 'bg-green-100 text-green-700'
		return 'bg-yellow-100 text-yellow-700'
	}
</script>

<svelte:head>
	<title>Separation — {s.employee.lastName}, {s.employee.firstName}</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<a href="/separations" class="text-sm text-muted-foreground hover:underline">← Separations</a>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}
	{#if form?.finalized}
		<div class="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
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
		<div class="flex items-center justify-between border-b px-4 py-3">
			<h2 class="font-semibold">Clearance checklist</h2>
			<span class="text-xs text-muted-foreground"
				>{s.clearanceItems.length - pendingCount}/{s.clearanceItems.length} cleared</span
			>
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
								? 'bg-green-100 text-green-700'
								: 'bg-yellow-100 text-yellow-700'}">{item.status}</span
						>
					{:else}
						<form method="POST" action="?/toggleClearance" use:enhance>
							<input type="hidden" name="itemId" value={item.id} />
							<input
								type="hidden"
								name="cleared"
								value={item.status === 'CLEARED' ? 'false' : 'true'}
							/>
							<button
								type="submit"
								class="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent {item.status ===
								'CLEARED'
									? 'text-green-700'
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
			<form
				method="POST"
				action="?/finalize"
				use:enhance={({ cancel }) => {
					if (
						!confirm(
							'Finalize this separation? This snapshots final pay, offboards the employee, and disables their login. It cannot be undone.'
						)
					)
						cancel()
				}}
				class="mt-3"
			>
				<button
					type="submit"
					disabled={pendingCount > 0}
					class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
					>Finalize &amp; offboard</button
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
