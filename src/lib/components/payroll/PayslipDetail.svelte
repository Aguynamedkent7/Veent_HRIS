<script lang="ts">
	import { formatCurrency, formatDate } from '$lib/utils/format'

	interface Props {
		entry: {
			employee: {
				firstName: string
				lastName: string
				employeeNumber: string
				jobTitle: string
				department: { name: string }
			}
			payrollRun: {
				periodStart: Date | string
				periodEnd: Date | string
				approvedAt: Date | string | null
			}
			grossPay: number | string
			sssEe: number | string
			philhealthEe: number | string
			pagibigEe: number | string
			withholdingTax: number | string
			totalDeductions: number | string
			netPay: number | string
		}
	}

	let { entry }: Props = $props()

	const gross = Number(entry.grossPay)
	const sss = Number(entry.sssEe)
	const philhealth = Number(entry.philhealthEe)
	const pagibig = Number(entry.pagibigEe)
	const tax = Number(entry.withholdingTax)
	const totalDed = Number(entry.totalDeductions)
	const net = Number(entry.netPay)
</script>

<div class="mx-auto max-w-2xl bg-white p-8 text-sm print:p-4">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between border-b pb-4">
		<div>
			<h1 class="text-xl font-bold tracking-tight text-gray-900">Veent Corp</h1>
			<p class="text-xs text-gray-500 mt-0.5">Human Resources Information System</p>
		</div>
		<div class="text-right">
			<h2 class="text-lg font-bold uppercase tracking-widest text-gray-700">Payslip</h2>
			<p class="text-xs text-gray-500">
				{formatDate(entry.payrollRun.periodStart)} &ndash; {formatDate(entry.payrollRun.periodEnd)}
			</p>
			{#if entry.payrollRun.approvedAt}
				<p class="text-xs text-gray-400 mt-0.5">Approved: {formatDate(entry.payrollRun.approvedAt)}</p>
			{/if}
		</div>
	</div>

	<!-- Employee Info -->
	<div class="mb-6 grid grid-cols-2 gap-4 rounded-md border bg-gray-50 p-4">
		<div>
			<p class="text-xs font-medium uppercase tracking-wide text-gray-500">Employee Name</p>
			<p class="mt-0.5 font-semibold text-gray-900">
				{entry.employee.lastName}, {entry.employee.firstName}
			</p>
		</div>
		<div>
			<p class="text-xs font-medium uppercase tracking-wide text-gray-500">Employee Number</p>
			<p class="mt-0.5 font-mono text-gray-900">{entry.employee.employeeNumber}</p>
		</div>
		<div>
			<p class="text-xs font-medium uppercase tracking-wide text-gray-500">Job Title</p>
			<p class="mt-0.5 text-gray-900">{entry.employee.jobTitle}</p>
		</div>
		<div>
			<p class="text-xs font-medium uppercase tracking-wide text-gray-500">Department</p>
			<p class="mt-0.5 text-gray-900">{entry.employee.department.name}</p>
		</div>
	</div>

	<!-- Earnings & Deductions side by side -->
	<div class="mb-6 grid grid-cols-2 gap-4">
		<!-- Earnings -->
		<div>
			<h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Earnings</h3>
			<table class="w-full rounded-md border text-sm">
				<thead>
					<tr class="border-b bg-gray-50">
						<th class="px-3 py-2 text-left font-medium text-gray-600">Description</th>
						<th class="px-3 py-2 text-right font-medium text-gray-600">Amount</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b">
						<td class="px-3 py-2 text-gray-700">Basic Pay</td>
						<td class="px-3 py-2 text-right font-mono text-gray-900">{formatCurrency(gross)}</td>
					</tr>
				</tbody>
				<tfoot>
					<tr class="bg-gray-50">
						<td class="px-3 py-2 font-semibold text-gray-900">Total Earnings</td>
						<td class="px-3 py-2 text-right font-mono font-semibold text-gray-900">{formatCurrency(gross)}</td>
					</tr>
				</tfoot>
			</table>
		</div>

		<!-- Deductions -->
		<div>
			<h3 class="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Deductions</h3>
			<table class="w-full rounded-md border text-sm">
				<thead>
					<tr class="border-b bg-gray-50">
						<th class="px-3 py-2 text-left font-medium text-gray-600">Description</th>
						<th class="px-3 py-2 text-right font-medium text-gray-600">Amount</th>
					</tr>
				</thead>
				<tbody>
					<tr class="border-b">
						<td class="px-3 py-2 text-gray-700">SSS</td>
						<td class="px-3 py-2 text-right font-mono text-gray-900">{formatCurrency(sss)}</td>
					</tr>
					<tr class="border-b">
						<td class="px-3 py-2 text-gray-700">PhilHealth</td>
						<td class="px-3 py-2 text-right font-mono text-gray-900">{formatCurrency(philhealth)}</td>
					</tr>
					<tr class="border-b">
						<td class="px-3 py-2 text-gray-700">Pag-IBIG</td>
						<td class="px-3 py-2 text-right font-mono text-gray-900">{formatCurrency(pagibig)}</td>
					</tr>
					<tr class="border-b">
						<td class="px-3 py-2 text-gray-700">Withholding Tax</td>
						<td class="px-3 py-2 text-right font-mono text-gray-900">{formatCurrency(tax)}</td>
					</tr>
				</tbody>
				<tfoot>
					<tr class="bg-gray-50">
						<td class="px-3 py-2 font-semibold text-gray-900">Total Deductions</td>
						<td class="px-3 py-2 text-right font-mono font-semibold text-gray-900">{formatCurrency(totalDed)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	</div>

	<!-- Net Pay -->
	<div class="rounded-md border-2 border-gray-900 bg-gray-900 p-4 text-white">
		<div class="flex items-center justify-between">
			<span class="text-sm font-bold uppercase tracking-widest">Net Pay</span>
			<span class="text-2xl font-bold font-mono">{formatCurrency(net)}</span>
		</div>
	</div>

	<p class="mt-4 text-center text-xs text-gray-400">
		This is a system-generated payslip and does not require a signature.
	</p>
</div>

<style>
	@media print {
		:global(body) {
			background: white;
		}
	}
</style>
