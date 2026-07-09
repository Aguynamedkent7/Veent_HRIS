<script lang="ts">
	import PayslipDetail from '$lib/components/payroll/PayslipDetail.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
</script>

<svelte:head>
	<title>Payslip — Veent HRIS</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between print:hidden">
		<a href="/payslips" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; My Payslips
		</a>
		<button
			onclick={() => window.print()}
			class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			Print Payslip
		</button>
	</div>

	<PayslipDetail entry={data.entry} />
</div>
