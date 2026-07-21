<script lang="ts">
	import { formatDateRange, formatCurrency } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const pdfUrl = $derived(`/api/v1/payroll/payslips/${data.entry.id}/pdf`)
</script>

<svelte:head>
	<title>Payslip — Veent HRIS</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<a href="/payslips" class="text-sm text-muted-foreground hover:text-foreground">
			&larr; My Payslips
		</a>
		<a
			href={pdfUrl}
			download={`payslip-${data.entry.id}.pdf`}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			Download PDF
		</a>
	</div>

	<section class="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
		<div>
			<p class="text-xs uppercase text-muted-foreground">Employee</p>
			<p class="text-sm font-medium">
				{data.entry.employee.firstName}
				{data.entry.employee.lastName}
			</p>
			<p class="text-xs text-muted-foreground">{data.entry.employee.jobTitle}</p>
		</div>
		<div>
			<p class="text-xs uppercase text-muted-foreground">Period</p>
			<p class="text-sm font-medium">
				{formatDateRange(data.entry.payrollRun.periodStart, data.entry.payrollRun.periodEnd)}
			</p>
		</div>
		<div>
			<p class="text-xs uppercase text-muted-foreground">Net Pay</p>
			<p class="text-lg font-semibold">{formatCurrency(data.entry.netPay)}</p>
		</div>
	</section>

	<div class="overflow-hidden rounded-lg border bg-white">
		<iframe src={pdfUrl} title="Payslip preview" class="h-[720px] w-full border-0" loading="lazy"
		></iframe>
	</div>
</div>
