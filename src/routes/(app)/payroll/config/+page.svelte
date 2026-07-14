<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let payFrequency = $state(data.config?.payFrequency ?? 'SEMI_MONTHLY')
	let philhealthRate = $state(Number(data.config?.philhealthRate ?? 0.05) * 100)
	let pagibigRate = $state(Number(data.config?.pagibigRate ?? 0.02) * 100)
	let cutoffDay1 = $state(data.config?.firstCutoff ?? 15)
	let cutoffDay2 = $state(data.config?.secondCutoff ?? 30)
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
		<div class="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
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

	<form method="POST" action="?/update" use:enhance class="rounded-md border bg-card p-6 space-y-6">
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
						step="0.01"
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
						step="0.01"
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
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Save Configuration
			</button>
		</div>
	</form>
</div>
