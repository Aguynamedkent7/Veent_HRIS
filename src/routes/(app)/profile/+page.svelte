<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatDate, formatCurrency } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const emp = $derived(data.employee)

	const CAT_LABELS: Record<string, string> = {
		CONTRACT: 'Contract',
		GOVERNMENT_ID: 'Government ID',
		RESUME: 'Résumé',
		PAYROLL_FORM: 'Payroll Form',
		EXIT_DOCUMENT: 'Exit Document',
		OTHER: 'Other'
	}
	const fmtSize = (b: number) =>
		b < 1024 * 1024
			? `${Math.max(1, Math.round(b / 1024))} KB`
			: `${(b / 1024 / 1024).toFixed(1)} MB`
</script>

<svelte:head>
	<title>My Profile — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="page-header">
		<h1 class="page-title">My Profile</h1>
	</div>

	{#if form?.success}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400"
		>
			Profile updated successfully.
		</div>
	{/if}

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400"
		>
			{form.error}
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Employment Details (read-only) -->
		<section class="card space-y-5">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Employment Details
			</h2>
			<dl class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-muted-foreground">Employee Number</dt>
						<dd class="mt-0.5 text-sm font-medium">{emp.employeeNumber}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Job Title</dt>
						<dd class="mt-0.5 text-sm font-medium">{emp.jobTitle}</dd>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-muted-foreground">Department</dt>
						<dd class="mt-0.5 text-sm font-medium">{emp.department?.name ?? '—'}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Employment Type</dt>
						<dd class="mt-0.5 text-sm font-medium">{emp.employmentType.replace(/_/g, ' ')}</dd>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-muted-foreground">Start Date</dt>
						<dd class="mt-0.5 text-sm font-medium">{formatDate(emp.startDate)}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Reports To</dt>
						<dd class="mt-0.5 text-sm font-medium">
							{#if emp.reportsTo}
								{emp.reportsTo.lastName}, {emp.reportsTo.firstName}
							{:else}
								—
							{/if}
						</dd>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<dt class="text-xs text-muted-foreground">Email</dt>
						<dd class="mt-0.5 text-sm font-medium">{emp.user.email}</dd>
					</div>
					<div>
						<dt class="text-xs text-muted-foreground">Status</dt>
						<dd class="mt-0.5">
							<span class="badge-{emp.employmentStatus === 'ACTIVE' ? 'green' : 'gray'}">
								{emp.employmentStatus}
							</span>
						</dd>
					</div>
				</div>
			</dl>
		</section>

		<!-- Personal & Contact (editable) -->
		<section class="card space-y-5">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Personal &amp; Contact
			</h2>
			<form method="POST" action="?/update" use:enhance class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<label for="firstName" class="text-xs font-medium text-muted-foreground"
							>First Name</label
						>
						<input
							id="firstName"
							name="firstName"
							type="text"
							value={emp.firstName}
							class="input"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="lastName" class="text-xs font-medium text-muted-foreground">Last Name</label
						>
						<input id="lastName" name="lastName" type="text" value={emp.lastName} class="input" />
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="contactPhone" class="text-xs font-medium text-muted-foreground">Phone</label>
					<input
						id="contactPhone"
						name="contactPhone"
						type="tel"
						value={emp.contactPhone ?? ''}
						class="input"
					/>
				</div>

				<div class="space-y-1.5">
					<label for="contactAddress" class="text-xs font-medium text-muted-foreground"
						>Address</label
					>
					<textarea
						id="contactAddress"
						name="contactAddress"
						rows="2"
						class="input h-auto resize-none py-2">{emp.contactAddress ?? ''}</textarea
					>
				</div>

				<div class="space-y-1.5">
					<label for="dateOfBirth" class="text-xs font-medium text-muted-foreground"
						>Date of Birth</label
					>
					<input
						id="dateOfBirth"
						name="dateOfBirth"
						type="date"
						value={emp.dateOfBirth ? new Date(emp.dateOfBirth).toISOString().slice(0, 10) : ''}
						class="input"
					/>
				</div>

				<div class="pt-2">
					<button type="submit" class="btn-primary"> Save Changes </button>
				</div>
			</form>
		</section>
	</div>

	<!-- My Documents (read-only; HR maintains the 201 file) -->
	<section class="card space-y-4">
		<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
			My Documents
		</h2>
		{#if data.documents.length}
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Document</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">Size</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">Uploaded</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.documents as doc (doc.id)}
							<tr class="hover:bg-muted/30">
								<td class="px-3 py-2">{CAT_LABELS[doc.category] ?? doc.category}</td>
								<td class="px-3 py-2">
									<a
										href="/api/v1/employees/{emp.id}/documents/{doc.id}"
										class="font-medium text-primary hover:underline">{doc.label}</a
									>
									<span class="block text-xs text-muted-foreground">{doc.fileName}</span>
								</td>
								<td class="px-3 py-2 text-right text-muted-foreground">{fmtSize(doc.size)}</td>
								<td class="px-3 py-2 text-right text-muted-foreground"
									>{formatDate(doc.uploadedAt)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">
				No documents on file. HR uploads contracts, IDs, and other records here.
			</p>
		{/if}
	</section>

	<!-- My Benefits (read-only) -->
	<section class="card space-y-4">
		<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
			My Benefits
		</h2>
		{#if data.benefits.length}
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Plan</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Coverage</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">My Cost</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.benefits as b (b.id)}
							<tr class="hover:bg-muted/30 {b.status === 'ACTIVE' ? '' : 'opacity-60'}">
								<td class="px-3 py-2 font-medium">{b.plan.name}</td>
								<td class="px-3 py-2 text-muted-foreground">{b.plan.type.replace('_', ' ')}</td>
								<td class="px-3 py-2 text-muted-foreground">{b.coverageLevel ?? '—'}</td>
								<td class="px-3 py-2 text-right"
									>{b.plan.employeeCost != null
										? formatCurrency(Number(b.plan.employeeCost))
										: '—'}</td
								>
								<td class="px-3 py-2">
									<span
										class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {b.status ===
										'ACTIVE'
											? 'bg-green-100 text-green-700'
											: b.status === 'WAIVED'
												? 'bg-yellow-100 text-yellow-700'
												: 'bg-gray-100 text-gray-600'}">{b.status}</span
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">
				You have no benefit enrollments. HR manages enrollments.
			</p>
		{/if}
	</section>
</div>
