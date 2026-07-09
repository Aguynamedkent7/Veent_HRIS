<script lang="ts">
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
</script>

<svelte:head>
	<title>My Payslips — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">My Payslips</h1>
		<p class="mt-1 text-sm text-muted-foreground">View and download your approved payslips.</p>
	</div>

	<div class="rounded-md border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Gross Pay</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Deductions</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Net Pay</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.payslips as payslip (payslip.id)}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3">
							{formatShortDate(payslip.payrollRun.periodStart)} &ndash; {formatShortDate(payslip.payrollRun.periodEnd)}
						</td>
						<td class="px-4 py-3 text-right font-mono">{formatCurrency(Number(payslip.grossPay))}</td>
						<td class="px-4 py-3 text-right font-mono text-muted-foreground">
							{formatCurrency(Number(payslip.totalDeductions))}
						</td>
						<td class="px-4 py-3 text-right font-mono font-medium">
							{formatCurrency(Number(payslip.netPay))}
						</td>
						<td class="px-4 py-3">
							<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
								{payslip.payrollRun.status}
							</span>
						</td>
						<td class="px-4 py-3 text-right">
							<a
								href="/payslips/{payslip.id}"
								class="text-xs font-medium text-primary hover:underline"
							>
								View
							</a>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-10 text-center text-muted-foreground">
							No approved payslips yet.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
