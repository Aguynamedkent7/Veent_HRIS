<script lang="ts">
	import CalculatorPanel from '$lib/components/payroll/CalculatorPanel.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
</script>

<svelte:head>
	<title>Payroll Calculator — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-3">
		<a href="/payroll" class="text-sm text-muted-foreground hover:text-foreground">← Payroll</a>
		<h1 class="text-2xl font-bold tracking-tight">Payroll Calculator</h1>
		<span class="text-xs text-muted-foreground">what-if preview — nothing is saved</span>
	</div>

	<CalculatorPanel employees={data.employees} recurringDefaults={data.recurringDefaults} />
</div>
