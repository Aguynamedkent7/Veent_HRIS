<script lang="ts">
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const cards = [
		{ href: '/settings/company', title: 'Company Information', desc: 'Name, address, logo', super: false },
		{ href: '/settings/org', title: 'Org Structure', desc: 'Departments & positions', super: false },
		{ href: '/settings/schedules', title: 'Work Schedules', desc: 'Shift templates', super: false },
		{ href: '/settings/pay-codes', title: 'Earnings & Deductions', desc: 'Payroll codes', super: false },
		{ href: '/settings/salary-grades', title: 'Salary Grades', desc: 'Pay bands per position', super: false },
		{ href: '/payroll/config', title: 'Payroll Config', desc: 'Cutoffs, frequency, statutory rates', super: true },
		{ href: '/settings/holidays', title: 'Holiday Calendar', desc: 'Regular & special holidays', super: true },
		{ href: '/settings/roles', title: 'Roles & Access', desc: 'User role management', super: true }
	]
	const visible = $derived(cards.filter((c) => !c.super || data.isSuperAdmin))
</script>

<svelte:head>
	<title>Settings — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Settings</h1>
		<p class="text-sm text-muted-foreground">Master data and configuration for your organization.</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each visible as c (c.href)}
			<a href={c.href} class="rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/80">
				<p class="font-medium">{c.title}</p>
				<p class="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
			</a>
		{/each}
	</div>
</div>
