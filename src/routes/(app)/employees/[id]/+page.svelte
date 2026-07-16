<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import ConfirmButton from '$lib/components/ui/ConfirmButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	// Reactive: after a form action re-runs `load`, these must reflect the fresh data
	// (a plain destructure would stay stale until a full page refresh).
	const employee = $derived(data.employee)
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
		<a
			href={canManage ? '/employees' : '/team'}
			class="text-sm text-muted-foreground hover:text-foreground"
			>← {canManage ? 'Employees' : 'Team'}</a
		>
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
		<!-- Onboarding checklist (HR-only, T178) -->
		{#if canManage && data.onboarding}
			<section
				class="rounded-lg border p-6 space-y-4 lg:col-span-2 {data.onboarding.complete
					? 'border-green-500/30 bg-green-500/5'
					: 'border-amber-500/30 bg-amber-500/5'}"
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="font-semibold">
						Onboarding
						{#if data.onboarding.complete}
							<span class="ml-1 text-sm font-normal text-green-600">✓ Complete</span>
						{/if}
					</h2>
					<span class="text-sm text-muted-foreground">
						{data.onboarding.doneCount} / {data.onboarding.total} steps
					</span>
				</div>

				{#if !data.onboarding.complete}
					<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-all"
							style="width: {(data.onboarding.doneCount / data.onboarding.total) * 100}%"
						></div>
					</div>
					<ul class="columns-1 gap-x-8 sm:columns-2">
						{#each data.onboarding.steps as step (step.key)}
							<li class="mb-2.5 flex items-start gap-2 break-inside-avoid text-sm">
								<span
									class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold {step.done
										? 'bg-green-500 text-white'
										: 'border border-muted-foreground/40 text-transparent'}"
								>
									✓
								</span>
								<span>
									<span class={step.done ? 'text-foreground' : 'font-medium text-foreground'}>
										{step.label}
									</span>
									{#if !step.done}
										<span class="block text-xs text-muted-foreground">{step.hint}</span>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}

		<!-- Profile Card -->
		<div class="rounded-lg border bg-card p-6 space-y-4">
			<h2 class="font-semibold">Profile</h2>
			<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
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
				<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
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

			<!-- Disbursement details Card (sensitive, HR-only) -->
			<div class="rounded-lg border bg-card p-6 space-y-4">
				<h2 class="font-semibold">
					Disbursement
					<span class="text-xs font-normal text-muted-foreground">(bank / GCash — sensitive)</span>
				</h2>
				<dl class="grid grid-cols-2 gap-3 text-sm">
					<dt class="text-muted-foreground">Bank</dt>
					<dd>{employee.bankName ?? '—'}</dd>
					<dt class="text-muted-foreground">Account Name</dt>
					<dd>{employee.bankAccountName ?? '—'}</dd>
					<dt class="text-muted-foreground">Account No.</dt>
					<dd class="font-mono">{employee.bankAccountNumber ?? '—'}</dd>
					<dt class="text-muted-foreground">GCash No.</dt>
					<dd class="font-mono">{employee.gcashNumber ?? '—'}</dd>
				</dl>
			</div>
		{/if}

		<!-- Emergency Contact Card (visible to managers) -->
		<div class="rounded-lg border bg-card p-6 space-y-4">
			<h2 class="font-semibold">Emergency Contact</h2>
			<dl class="grid grid-cols-2 gap-3 text-sm">
				<dt class="text-muted-foreground">Name</dt>
				<dd>{employee.emergencyContactName ?? '—'}</dd>
				<dt class="text-muted-foreground">Relationship</dt>
				<dd>{employee.emergencyContactRelation ?? '—'}</dd>
				<dt class="text-muted-foreground">Phone</dt>
				<dd>{employee.emergencyContactPhone ?? '—'}</dd>
			</dl>
		</div>

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
						<label for="jobTitle" class="text-sm font-medium">Job Title</label>
						<input
							id="jobTitle"
							name="jobTitle"
							value={employee.jobTitle}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="departmentId" class="text-sm font-medium">Department</label>
						<select
							id="departmentId"
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
						<label for="basicMonthlySalary" class="text-sm font-medium">Basic Monthly Salary</label>
						<input
							id="basicMonthlySalary"
							name="basicMonthlySalary"
							type="number"
							value={Number(employee.basicMonthlySalary)}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div class="sm:col-span-3">
						<label for="discordId" class="text-sm font-medium">Discord ID</label>
						<input
							id="discordId"
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
						<label for="workScheduleId" class="text-sm font-medium">Work Schedule</label>
						<select
							id="workScheduleId"
							name="workScheduleId"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="">Default (Mon–Fri 9–6)</option>
							{#each data.schedules as s (s.id)}
								<option value={s.id} selected={s.id === employee.workScheduleId}>{s.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="positionId" class="text-sm font-medium">Position</label>
						<select
							id="positionId"
							name="positionId"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<option value="">— No position —</option>
							{#each data.positions as p (p.id)}
								<option value={p.id} selected={p.id === employee.positionId}>{p.title}</option>
							{/each}
						</select>
						<p class="mt-1 text-xs text-muted-foreground">
							Sets the pay band used for the salary check above.
						</p>
					</div>
					<div class="sm:col-span-3 border-t pt-3">
						<h3 class="text-sm font-semibold text-muted-foreground">
							Government IDs <span class="font-normal">(payroll registration)</span>
						</h3>
					</div>
					<div>
						<label for="sssNumber" class="text-sm font-medium">SSS Number</label>
						<input
							id="sssNumber"
							name="sssNumber"
							value={employee.sssNumber ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="philhealthNumber" class="text-sm font-medium">PhilHealth No.</label>
						<input
							id="philhealthNumber"
							name="philhealthNumber"
							value={employee.philhealthNumber ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="pagibigNumber" class="text-sm font-medium">Pag-IBIG No.</label>
						<input
							id="pagibigNumber"
							name="pagibigNumber"
							value={employee.pagibigNumber ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="tinNumber" class="text-sm font-medium">TIN</label>
						<input
							id="tinNumber"
							name="tinNumber"
							value={employee.tinNumber ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div class="sm:col-span-3 border-t pt-3">
						<h3 class="text-sm font-semibold text-muted-foreground">Emergency Contact</h3>
					</div>
					<div>
						<label for="emergencyContactName" class="text-sm font-medium">Contact Name</label>
						<input
							id="emergencyContactName"
							name="emergencyContactName"
							value={employee.emergencyContactName ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="emergencyContactRelation" class="text-sm font-medium">Relationship</label>
						<input
							id="emergencyContactRelation"
							name="emergencyContactRelation"
							value={employee.emergencyContactRelation ?? ''}
							placeholder="e.g. Spouse, Parent"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="emergencyContactPhone" class="text-sm font-medium">Contact Phone</label>
						<input
							id="emergencyContactPhone"
							name="emergencyContactPhone"
							value={employee.emergencyContactPhone ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div class="sm:col-span-3 border-t pt-3">
						<h3 class="text-sm font-semibold text-muted-foreground">
							Disbursement <span class="font-normal">(bank / GCash — sensitive)</span>
						</h3>
					</div>
					<div>
						<label for="bankName" class="text-sm font-medium">Bank Name</label>
						<input
							id="bankName"
							name="bankName"
							value={employee.bankName ?? ''}
							placeholder="e.g. BDO"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="bankAccountName" class="text-sm font-medium">Account Name</label>
						<input
							id="bankAccountName"
							name="bankAccountName"
							value={employee.bankAccountName ?? ''}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="bankAccountNumber" class="text-sm font-medium">Bank Account No.</label>
						<input
							id="bankAccountNumber"
							name="bankAccountNumber"
							value={employee.bankAccountNumber ?? ''}
							placeholder="Account number"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="gcashNumber" class="text-sm font-medium">GCash No.</label>
						<input
							id="gcashNumber"
							name="gcashNumber"
							value={employee.gcashNumber ?? ''}
							placeholder="e.g. 0917xxxxxxx"
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
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
						<label for="endDate" class="text-sm font-medium">Last Day</label>
						<input
							id="endDate"
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

		<!-- Emergency Contacts (visible to any viewer of the 201 file; HR manages) -->
		<section class="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
			<h2 class="font-semibold">
				Emergency Contacts
				<span class="text-xs font-normal text-muted-foreground">(name, relationship, phone)</span>
			</h2>

			{#if employee.emergencyContacts.length}
				<div class="rounded-md border">
					<table class="w-full text-sm">
						<thead class="border-b bg-muted/50">
							<tr>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Relationship</th>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Phone</th>
								{#if canManage}<th class="px-3 py-2"></th>{/if}
							</tr>
						</thead>
						<tbody class="divide-y">
							{#each employee.emergencyContacts as c (c.id)}
								<tr class="hover:bg-muted/30">
									<td class="px-3 py-2 font-medium">{c.name}</td>
									<td class="px-3 py-2">{c.relationship}</td>
									<td class="px-3 py-2 font-mono">{c.phone}</td>
									{#if canManage}
										<td class="px-3 py-2 text-right">
											<form method="POST" action="?/deleteEmergencyContact" use:enhance>
												<input type="hidden" name="contactId" value={c.id} />
												<button type="submit" class="text-xs text-red-600 hover:underline"
													>Remove</button
												>
											</form>
										</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-xs text-muted-foreground">No emergency contacts on record.</p>
			{/if}

			{#if canManage}
				<form
					method="POST"
					action="?/addEmergencyContact"
					use:enhance
					class="flex flex-wrap items-end gap-2 border-t pt-3"
				>
					<div class="grid gap-1">
						<label for="ec-name" class="text-xs font-medium text-muted-foreground">Name</label>
						<input
							id="ec-name"
							name="name"
							type="text"
							required
							placeholder="Full name"
							class="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs"
						/>
					</div>
					<div class="grid gap-1">
						<label for="ec-rel" class="text-xs font-medium text-muted-foreground"
							>Relationship</label
						>
						<input
							id="ec-rel"
							name="relationship"
							type="text"
							required
							placeholder="e.g. Spouse"
							class="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
						/>
					</div>
					<div class="grid gap-1">
						<label for="ec-phone" class="text-xs font-medium text-muted-foreground">Phone</label>
						<input
							id="ec-phone"
							name="phone"
							type="tel"
							required
							placeholder="e.g. 0917xxxxxxx"
							class="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
						/>
					</div>
					<button
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>Add Contact</button
					>
				</form>
			{/if}
		</section>

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
				<h2 class="font-semibold">Recurring Allowances &amp; Incentives</h2>
				<p class="text-xs text-muted-foreground">
					Monthly amounts, prorated to each payroll period and added to the payslip's Allowances /
					Incentives lines. Ended items stop from the next payroll run.
				</p>
				{#if data.recurringEarnings.length}
					<table class="w-full text-sm">
						<tbody class="divide-y">
							{#each data.recurringEarnings as e (e.id)}
								<tr>
									<td class="py-1.5">{e.label}</td>
									<td class="py-1.5 text-muted-foreground"
										>{e.kind === 'ALLOWANCE' ? 'Allowance' : 'Incentive'}</td
									>
									<td class="py-1.5 text-right font-mono"
										>{formatCurrency(Number(e.monthlyAmount))}<span
											class="ml-1 text-xs text-muted-foreground">/mo</span
										></td
									>
									<td class="py-1.5 text-right">
										{#if e.isActive}
											<form method="POST" action="?/endEarning" use:enhance>
												<input type="hidden" name="id" value={e.id} />
												<button
													type="submit"
													class="rounded-md border border-red-200 px-2 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
													>End</button
												>
											</form>
										{:else}
											<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
												>ENDED</span
											>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="text-xs text-muted-foreground">No recurring allowances or incentives.</p>
				{/if}
				<form
					method="POST"
					action="?/addEarning"
					use:enhance
					class="flex flex-wrap items-end gap-2"
				>
					<select name="kind" class="h-8 rounded-md border border-input bg-background px-2 text-xs">
						<option value="ALLOWANCE">Allowance</option>
						<option value="INCENTIVE">Incentive</option>
					</select>
					<input
						name="label"
						placeholder="Label (e.g. Meal allowance)"
						required
						class="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
					/>
					<input
						name="monthlyAmount"
						type="number"
						min="0.01"
						step="0.01"
						placeholder="Monthly amount"
						required
						class="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
					/>
					<button
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>Add</button
					>
				</form>
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
					<div class="overflow-x-auto rounded-md border">
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
											<ConfirmButton
												action="?/deleteDocument"
												title="Delete document?"
												message="“{doc.label}” will be permanently removed."
												triggerClass="text-xs text-red-600 hover:underline"
											>
												<input type="hidden" name="docId" value={doc.id} />
											</ConfirmButton>
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

		{#if canManage}
			<section class="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
				<h2 class="font-semibold">
					Employment History
					<span class="text-xs font-normal text-muted-foreground"
						>(promotions, salary, transfers, status — from the audit trail)</span
					>
				</h2>

				{#if data.history.length}
					<ol class="relative space-y-5 border-l pl-6">
						{#each data.history as ev (ev.id)}
							<li class="relative">
								<span
									class="absolute -left-[27px] mt-1 h-3 w-3 rounded-full border-2 border-background {ev.type ===
									'HIRED'
										? 'bg-green-500'
										: 'bg-primary'}"
								></span>
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<span class="text-sm font-medium">
										{ev.type === 'HIRED' ? 'Hired / record created' : 'Profile updated'}
									</span>
									<span class="text-xs text-muted-foreground">{formatShortDate(ev.date)}</span>
								</div>
								{#if ev.changes.length}
									<ul class="mt-1 space-y-0.5 text-sm text-muted-foreground">
										{#each ev.changes as c (c.label)}
											<li>
												<span class="font-medium text-foreground">{c.label}:</span>
												{c.from} <span aria-hidden="true">→</span>
												<span class="text-foreground">{c.to}</span>
											</li>
										{/each}
									</ul>
								{/if}
								{#if ev.actorEmail}
									<p class="mt-1 text-xs text-muted-foreground/70">by {ev.actorEmail}</p>
								{/if}
							</li>
						{/each}
					</ol>
				{:else}
					<p class="text-xs text-muted-foreground">No recorded changes yet.</p>
				{/if}
			</section>
		{/if}
	</div>
</div>
