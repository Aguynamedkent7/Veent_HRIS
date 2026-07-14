<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const { employee } = data
	const canManage = $derived(data.canManage)

	const DOC_CATEGORIES = [
		{ value: 'CONTRACT', label: 'Contract' },
		{ value: 'GOVERNMENT_ID', label: 'Government ID' },
		{ value: 'RESUME', label: 'Résumé' },
		{ value: 'PAYROLL_FORM', label: 'Payroll Form' },
		{ value: 'EXIT_DOCUMENT', label: 'Exit Document' },
		{ value: 'OTHER', label: 'Other' }
	]
	const catLabel = (v: string) => DOC_CATEGORIES.find((c) => c.value === v)?.label ?? v
	const fmtSize = (b: number) =>
		b < 1024 * 1024
			? `${Math.max(1, Math.round(b / 1024))} KB`
			: `${(b / 1024 / 1024).toFixed(1)} MB`

	// Salary-band check: employee inherits their grade via their position (T163).
	const grade = $derived(employee.position?.salaryGrade ?? null)
	const band = $derived.by(() => {
		if (!grade || employee.basicMonthlySalary == null) return null
		const s = Number(employee.basicMonthlySalary),
			min = Number(grade.minSalary),
			max = Number(grade.maxSalary)
		return { status: s < min ? 'below' : s > max ? 'above' : 'within', min, max, name: grade.name }
	})
</script>

<svelte:head>
	<title>{employee.lastName}, {employee.firstName} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		<a href="/employees" class="text-sm text-muted-foreground hover:text-foreground">← Employees</a>
		<h1 class="text-2xl font-bold">{employee.lastName}, {employee.firstName}</h1>
		<span
			class="rounded-full px-2.5 py-1 text-xs font-medium {employee.employmentStatus === 'ACTIVE'
				? 'bg-green-100 text-green-700'
				: 'bg-gray-100 text-gray-600'}"
		>
			{employee.employmentStatus}
		</span>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Profile Card -->
		<div class="rounded-lg border bg-card p-6 space-y-4">
			<h2 class="font-semibold">Profile</h2>
			<dl class="grid grid-cols-2 gap-3 text-sm">
				<dt class="text-muted-foreground">Employee No.</dt>
				<dd class="font-medium">{employee.employeeNumber}</dd>
				<dt class="text-muted-foreground">Email</dt>
				<dd>{employee.user.email}</dd>
				<dt class="text-muted-foreground">Department</dt>
				<dd>{employee.department.name}</dd>
				<dt class="text-muted-foreground">Job Title</dt>
				<dd>{employee.jobTitle}</dd>
				<dt class="text-muted-foreground">Employment Type</dt>
				<dd>{employee.employmentType.replace('_', ' ')}</dd>
				<dt class="text-muted-foreground">Start Date</dt>
				<dd>{formatShortDate(employee.startDate)}</dd>
				{#if canManage}
					<dt class="text-muted-foreground">Basic Salary</dt>
					<dd class="font-medium">
						{formatCurrency(Number(employee.basicMonthlySalary))}/mo
						{#if band}
							{#if band.status === 'within'}
								<span
									class="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-normal text-green-700"
									title="Within the {band.name} band">✓ {grade?.name}</span
								>
							{:else}
								<span
									class="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700"
									title="{band.name}: {formatCurrency(band.min)}–{formatCurrency(band.max)}"
								>
									⚠ {band.status === 'below' ? 'Below' : 'Above'}
									{grade?.name} band
								</span>
							{/if}
						{/if}
					</dd>
				{/if}
				<dt class="text-muted-foreground">Role</dt>
				<dd>{employee.user.role}</dd>
			</dl>
		</div>

		<!-- Government IDs Card (HR-only) -->
		{#if canManage}
			<div class="rounded-lg border bg-card p-6 space-y-4">
				<h2 class="font-semibold">Government IDs</h2>
				<dl class="grid grid-cols-2 gap-3 text-sm">
					<dt class="text-muted-foreground">SSS Number</dt>
					<dd>{employee.sssNumber ?? '—'}</dd>
					<dt class="text-muted-foreground">PhilHealth No.</dt>
					<dd>{employee.philhealthNumber ?? '—'}</dd>
					<dt class="text-muted-foreground">Pag-IBIG No.</dt>
					<dd>{employee.pagibigNumber ?? '—'}</dd>
					<dt class="text-muted-foreground">TIN</dt>
					<dd>{employee.tinNumber ?? '—'}</dd>
				</dl>
			</div>
		{/if}

		<!-- Edit Form (HR-only; the update/offboard actions require HR_ADMIN) -->
		{#if canManage && employee.employmentStatus === 'ACTIVE'}
			<form
				method="POST"
				action="?/update"
				use:enhance
				class="rounded-lg border p-6 space-y-4 lg:col-span-2"
			>
				<h2 class="font-semibold">Update Profile</h2>
				{#if form?.success}
					<div
						class="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-400"
					>
						Saved.
					</div>
				{:else if form?.error}
					<div
						class="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-red-400"
					>
						{form.error}
					</div>
				{/if}
				<div class="grid gap-3 sm:grid-cols-3">
					<div>
						<label class="text-sm font-medium">Job Title</label>
						<input
							name="jobTitle"
							value={employee.jobTitle}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label class="text-sm font-medium">Department</label>
						<select
							name="departmentId"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{#each data.departments as dept (dept.id)}
								<option value={dept.id} selected={dept.id === employee.departmentId}
									>{dept.name}</option
								>
							{/each}
						</select>
					</div>
					<div>
						<label class="text-sm font-medium">Basic Monthly Salary</label>
						<input
							name="basicMonthlySalary"
							type="number"
							value={Number(employee.basicMonthlySalary)}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div class="sm:col-span-3">
						<label class="text-sm font-medium">Discord ID</label>
						<input
							name="discordId"
							value={employee.discordId ?? ''}
							placeholder="e.g. 123456789012345678 — for the time-tracking bot"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<p class="mt-1 text-xs text-muted-foreground">
							In Discord: enable Developer Mode → right-click the user → Copy User ID. Leave blank
							to unlink.
						</p>
					</div>
					<div>
						<label class="text-sm font-medium">Work Schedule</label>
						<select
							name="workScheduleId"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="">Default (Mon–Fri 9–6)</option>
							{#each data.schedules as s (s.id)}
								<option value={s.id} selected={s.id === employee.workScheduleId}>{s.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="flex justify-end">
					<button
						type="submit"
						class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>Save Changes</button
					>
				</div>
			</form>

			<form
				method="POST"
				action="?/offboard"
				use:enhance
				class="rounded-lg border border-destructive/50 p-6 space-y-4"
			>
				<h2 class="font-semibold text-destructive">Offboard Employee</h2>
				<div class="flex items-end gap-4">
					<div>
						<label class="text-sm font-medium">Last Day</label>
						<input
							name="endDate"
							type="date"
							required
							class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<button
						type="submit"
						class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
						>Offboard</button
					>
				</div>
			</form>
		{/if}

		{#if canManage}
			<section class="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
				<h2 class="font-semibold">Loans &amp; Cash Advances</h2>
				<p class="text-xs text-muted-foreground">
					Active items amortize automatically each payroll period (fixed installment, capped at
					balance).
				</p>
				<div class="grid gap-6 lg:grid-cols-2">
					<!-- Loans -->
					<div class="space-y-3">
						<h3 class="text-sm font-semibold text-muted-foreground">Loans</h3>
						{#if data.loans.length}
							<table class="w-full text-sm">
								<tbody class="divide-y">
									{#each data.loans as l (l.id)}
										<tr>
											<td class="py-1.5">{l.type ?? 'Loan'}</td>
											<td class="py-1.5 text-right font-mono"
												>{formatCurrency(Number(l.balance))}<span
													class="ml-1 text-xs text-muted-foreground"
													>/ {formatCurrency(Number(l.installment))}·pd</span
												></td
											>
											<td class="py-1.5 text-right"
												><span
													class="rounded-full px-2 py-0.5 text-xs {l.status === 'PAID'
														? 'bg-green-100 text-green-700'
														: l.status === 'CANCELLED'
															? 'bg-gray-100 text-gray-600'
															: 'bg-blue-100 text-blue-700'}">{l.status}</span
												></td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<p class="text-xs text-muted-foreground">No loans on record.</p>
						{/if}
						<form
							method="POST"
							action="?/addLoan"
							use:enhance
							class="flex flex-wrap items-end gap-2"
						>
							<input
								name="type"
								placeholder="Type"
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<input
								name="principal"
								type="number"
								min="0"
								step="0.01"
								placeholder="Principal"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<input
								name="installment"
								type="number"
								min="0"
								step="0.01"
								placeholder="Per period"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<button
								class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
								>Add Loan</button
							>
						</form>
					</div>
					<!-- Cash advances -->
					<div class="space-y-3">
						<h3 class="text-sm font-semibold text-muted-foreground">Cash Advances</h3>
						{#if data.cashAdvances.length}
							<table class="w-full text-sm">
								<tbody class="divide-y">
									{#each data.cashAdvances as a (a.id)}
										<tr>
											<td class="py-1.5">Cash advance</td>
											<td class="py-1.5 text-right font-mono"
												>{formatCurrency(Number(a.balance))}<span
													class="ml-1 text-xs text-muted-foreground"
													>/ {formatCurrency(Number(a.installment))}·pd</span
												></td
											>
											<td class="py-1.5 text-right"
												><span
													class="rounded-full px-2 py-0.5 text-xs {a.status === 'PAID'
														? 'bg-green-100 text-green-700'
														: a.status === 'CANCELLED'
															? 'bg-gray-100 text-gray-600'
															: 'bg-blue-100 text-blue-700'}">{a.status}</span
												></td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						{:else}
							<p class="text-xs text-muted-foreground">No cash advances on record.</p>
						{/if}
						<form
							method="POST"
							action="?/addCashAdvance"
							use:enhance
							class="flex flex-wrap items-end gap-2"
						>
							<input
								name="amount"
								type="number"
								min="0"
								step="0.01"
								placeholder="Amount"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<input
								name="installment"
								type="number"
								min="0"
								step="0.01"
								placeholder="Per period"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<button
								class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
								>Add Advance</button
							>
						</form>
					</div>
				</div>
			</section>
		{/if}

		{#if canManage}
			<section class="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
				<h2 class="font-semibold">
					Documents <span class="text-xs font-normal text-muted-foreground"
						>(201 file — contracts, IDs, exit docs)</span
					>
				</h2>

				{#if data.documents.length}
					<div class="rounded-md border">
						<table class="w-full text-sm">
							<thead class="border-b bg-muted/50">
								<tr>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Document</th>
									<th class="px-3 py-2 text-right font-medium text-muted-foreground">Size</th>
									<th class="px-3 py-2 text-right font-medium text-muted-foreground">Uploaded</th>
									<th class="px-3 py-2"></th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each data.documents as doc (doc.id)}
									<tr class="hover:bg-muted/30">
										<td class="px-3 py-2">{catLabel(doc.category)}</td>
										<td class="px-3 py-2">
											<a
												href="/api/v1/employees/{employee.id}/documents/{doc.id}"
												class="font-medium text-primary hover:underline">{doc.label}</a
											>
											<span class="block text-xs text-muted-foreground">{doc.fileName}</span>
										</td>
										<td class="px-3 py-2 text-right text-muted-foreground">{fmtSize(doc.size)}</td>
										<td class="px-3 py-2 text-right text-muted-foreground"
											>{formatShortDate(doc.uploadedAt)}</td
										>
										<td class="px-3 py-2 text-right">
											<form method="POST" action="?/deleteDocument" use:enhance>
												<input type="hidden" name="docId" value={doc.id} />
												<button type="submit" class="text-xs text-red-600 hover:underline"
													>Delete</button
												>
											</form>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">No documents uploaded yet.</p>
				{/if}

				<form
					method="POST"
					action="?/uploadDocument"
					enctype="multipart/form-data"
					use:enhance
					class="flex flex-wrap items-end gap-2 border-t pt-3"
				>
					<div class="grid gap-1">
						<label for="doc-category" class="text-xs font-medium text-muted-foreground"
							>Category</label
						>
						<select
							id="doc-category"
							name="category"
							class="h-8 rounded-md border border-input bg-background px-2 text-xs"
						>
							{#each DOC_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
						</select>
					</div>
					<div class="grid gap-1">
						<label for="doc-label" class="text-xs font-medium text-muted-foreground"
							>Label <span class="text-muted-foreground/70">(optional)</span></label
						>
						<input
							id="doc-label"
							name="label"
							type="text"
							placeholder="e.g. 2026 Contract"
							class="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs"
						/>
					</div>
					<div class="grid gap-1">
						<label for="doc-file" class="text-xs font-medium text-muted-foreground"
							>File <span class="text-muted-foreground/70">(PDF/PNG/JPEG, ≤10 MB)</span></label
						>
						<input
							id="doc-file"
							name="file"
							type="file"
							accept="application/pdf,image/png,image/jpeg,image/webp"
							required
							class="text-xs"
						/>
					</div>
					<button
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>Upload</button
					>
				</form>
			</section>
		{/if}
	</div>
</div>
