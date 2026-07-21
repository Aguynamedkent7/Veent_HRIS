<script lang="ts">
	import { enhance } from '$app/forms'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import { tenureLabel } from '$lib/utils/dates'
	import { RATE_BASIS_OPTIONS, rateBasisCopy, type RateBasis } from '$lib/utils/rate-basis'
	import ConfirmButton from '$lib/components/ui/ConfirmButton.svelte'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	// Reactive: after a form action re-runs `load`, these must reflect the fresh data
	// (a plain destructure would stay stale until a full page refresh).
	const employee = $derived(data.employee)
	const canManage = $derived(data.canManage)
	// The schedule an unassigned employee actually falls back to, named from the org's data.
	const orgDefaultSchedule = $derived(data.schedules?.find((s) => s.isDefault) ?? null)
	// #54: `employee.bankAccountNumber`/`gcashNumber` arrive masked from the load.
	// The full values exist client-side only after the audited reveal action, and any
	// other action result (e.g. a profile save) drops back to the masked display.
	const revealed = $derived(form?.revealed ?? null)

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

	// #120: the amount field's label follows the selected basis, exactly as on the create form.
	// Seeded from the saved value and re-seeded whenever `load` re-runs after a save.
	let rateType = $state<RateBasis>('MONTHLY')
	$effect(() => {
		rateType = employee.rateType as RateBasis
	})
	const rate = $derived(rateBasisCopy(rateType))
	// Read-only display follows the SAVED basis, not the in-progress form selection.
	const savedRate = $derived(rateBasisCopy(employee.rateType as RateBasis))

	// Salary-band check: employee inherits their grade via their position (T163).
	// Grades are monthly bands (#120), so an hourly rate must not be scored against them.
	const grade = $derived(employee.position?.salaryGrade ?? null)
	const band = $derived.by(() => {
		if (employee.rateType !== 'MONTHLY') return null
		if (!grade || employee.basicMonthlySalary == null) return null
		const s = Number(employee.basicMonthlySalary),
			min = Number(grade.minSalary),
			max = Number(grade.maxSalary)
		return { status: s < min ? 'below' : s > max ? 'above' : 'within', min, max, name: grade.name }
	})

	// #108: every mutating form here is a duplicate-row risk on a double-click — duplicate
	// contacts, loans, cash advances, recurring earnings/deductions, uploaded documents, or a
	// second offboard/reveal. One guard per form; the per-row forms share the guard for their
	// action, which is fine because those rows submit one at a time.
	const revealDisbursement = createSubmitGuard()
	const update = createSubmitGuard()
	const offboard = createSubmitGuard()
	const deleteEmergencyContact = createSubmitGuard()
	const addEmergencyContact = createSubmitGuard()
	const addLoan = createSubmitGuard()
	const addCashAdvance = createSubmitGuard()
	const endEarning = createSubmitGuard()
	const addEarning = createSubmitGuard()
	const endDeduction = createSubmitGuard()
	const addDeduction = createSubmitGuard()
	const uploadDocument = createSubmitGuard()
</script>

<svelte:head>
	<title>{employee.lastName}, {employee.firstName} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		<BackButton
			fallback={canManage ? '/employees' : '/team'}
			label={canManage ? 'Employees' : 'Team'}
		/>
		<h1 class="text-2xl font-bold">{employee.lastName}, {employee.firstName}</h1>
		<span
			class="rounded-full px-2.5 py-1 text-xs font-medium {employee.employmentStatus === 'ACTIVE'
				? 'bg-green-500/15 text-green-400'
				: 'bg-gray-500/15 text-gray-400'}"
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
						{#each data.onboarding.steps as step (step.id)}
							<li class="mb-2.5 flex items-start gap-2 break-inside-avoid text-sm">
								{#if step.manual}
									<!-- Manual step: HR ticks it off (equipment issued, NDA signed, …). #116 -->
									<form method="POST" action="?/toggleOnboardingStep" use:enhance>
										<input type="hidden" name="itemId" value={step.id} />
										<input type="hidden" name="done" value={(!step.done).toString()} />
										<button
											type="submit"
											aria-pressed={step.done}
											aria-label="{step.done ? 'Uncheck' : 'Check'} {step.label}"
											class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold transition-colors {step.done
												? 'bg-green-500 text-white hover:bg-green-600'
												: 'border border-muted-foreground/40 text-transparent hover:border-primary hover:text-muted-foreground'}"
										>
											✓
										</button>
									</form>
								{:else}
									<span
										class="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold {step.done
											? 'bg-green-500 text-white'
											: 'border border-muted-foreground/40 text-transparent'}"
									>
										✓
									</span>
								{/if}
								<span>
									<span class={step.done ? 'text-foreground' : 'font-medium text-foreground'}>
										{step.label}
									</span>
									{#if step.manual}
										<span
											class="ml-1 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
											>manual</span
										>
									{/if}
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
				<dt class="text-muted-foreground">Tenure</dt>
				<dd>{tenureLabel(employee.startDate, employee.endDate ?? undefined)}</dd>
				{#if canManage}
					<dt class="text-muted-foreground">Basic Salary</dt>
					<dd class="font-medium">
						{formatCurrency(Number(employee.basicMonthlySalary))}{savedRate.suffix}
						{#if band}
							{#if band.status === 'within'}
								<span
									class="ml-1 rounded-full bg-green-500/15 px-1.5 py-0.5 text-xs font-normal text-green-400"
									title="Within the {band.name} band">✓ {grade?.name}</span
								>
							{:else}
								<span
									class="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-400"
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

			<!-- Disbursement details Card (sensitive, HR-only; numbers masked — #54) -->
			<div class="rounded-lg border bg-card p-6 space-y-4">
				<div class="flex items-center justify-between gap-3">
					<h2 class="font-semibold">
						Disbursement
						<span class="text-xs font-normal text-muted-foreground">(bank / GCash — sensitive)</span
						>
					</h2>
					{#if data.canRevealDisbursement && !revealed}
						<form
							method="POST"
							action="?/revealDisbursement"
							use:enhance={revealDisbursement.enhance}
						>
							<button
								type="submit"
								disabled={revealDisbursement.busy}
								class="text-xs text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
								title="Revealing full numbers is recorded in the audit log"
								>{revealDisbursement.busy ? 'Revealing…' : 'Reveal full numbers'}</button
							>
						</form>
					{/if}
				</div>
				<dl class="grid grid-cols-2 gap-3 text-sm">
					<dt class="text-muted-foreground">Bank</dt>
					<dd>{employee.bankName ?? '—'}</dd>
					<dt class="text-muted-foreground">Account Name</dt>
					<dd>{employee.bankAccountName ?? '—'}</dd>
					<dt class="text-muted-foreground">Account No.</dt>
					<dd class="font-mono">
						{revealed?.bankAccountNumber ?? employee.bankAccountNumber ?? '—'}
					</dd>
					<dt class="text-muted-foreground">GCash No.</dt>
					<dd class="font-mono">{revealed?.gcashNumber ?? employee.gcashNumber ?? '—'}</dd>
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
				use:enhance={update.enhance}
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
					{#if data.showBranches}
						<div>
							<label for="branchId" class="text-sm font-medium">Branch</label>
							<select
								id="branchId"
								name="branchId"
								class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<option value="">— No branch —</option>
								{#each data.branches as br (br.id)}
									<option value={br.id} selected={br.id === employee.branchId}
										>{br.name}{br.status === 'CLOSED' ? ' (closed)' : ''}</option
									>
								{/each}
							</select>
							<p class="mt-1 text-xs text-muted-foreground">
								Which store this employee works out of.
							</p>
						</div>
					{/if}
					<div>
						<label for="rateType" class="text-sm font-medium">Rate Basis</label>
						<select
							id="rateType"
							name="rateType"
							bind:value={rateType}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							{#each RATE_BASIS_OPTIONS as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
					<div>
						<label for="basicMonthlySalary" class="text-sm font-medium">{rate.label}</label>
						<input
							id="basicMonthlySalary"
							name="basicMonthlySalary"
							type="number"
							step={rate.step}
							min="0"
							value={Number(employee.basicMonthlySalary)}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<p class="mt-1 text-xs text-muted-foreground">{rate.hint}</p>
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
							<!-- Names the org's actual default rather than a hardcoded shift, so the label
							     cannot drift from what the attendance engine really applies. -->
							<option value=""
								>{orgDefaultSchedule
									? `Not assigned — follows ${orgDefaultSchedule.name}`
									: 'Not assigned — no organization default set'}</option
							>
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
						<p class="mt-1 text-xs text-muted-foreground">
							Stored numbers stay masked; leave a field blank to keep the current value.
						</p>
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
							value={revealed?.bankAccountNumber ?? ''}
							placeholder={employee.bankAccountNumber ?? 'Account number'}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
					<div>
						<label for="gcashNumber" class="text-sm font-medium">GCash No.</label>
						<input
							id="gcashNumber"
							name="gcashNumber"
							value={revealed?.gcashNumber ?? ''}
							placeholder={employee.gcashNumber ?? 'e.g. 0917xxxxxxx'}
							class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
				</div>
				<div class="flex justify-end">
					<button
						type="submit"
						disabled={update.busy}
						class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
						>{update.busy ? 'Saving…' : 'Save Changes'}</button
					>
				</div>
			</form>

			<form
				method="POST"
				action="?/offboard"
				use:enhance={offboard.enhance}
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
						disabled={offboard.busy}
						class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
						>{offboard.busy ? 'Offboarding…' : 'Offboard'}</button
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
											<form
												method="POST"
												action="?/deleteEmergencyContact"
												use:enhance={deleteEmergencyContact.enhance}
											>
												<input type="hidden" name="contactId" value={c.id} />
												<button
													type="submit"
													disabled={deleteEmergencyContact.busy}
													class="rounded-md border border-red-500/20 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:pointer-events-none disabled:opacity-50"
													>{deleteEmergencyContact.busy ? 'Removing…' : 'Remove'}</button
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
					use:enhance={addEmergencyContact.enhance}
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
						disabled={addEmergencyContact.busy}
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
						>{addEmergencyContact.busy ? 'Adding…' : 'Add Contact'}</button
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
														? 'bg-green-500/15 text-green-400'
														: l.status === 'CANCELLED'
															? 'bg-gray-500/15 text-gray-400'
															: 'bg-blue-500/15 text-blue-400'}">{l.status}</span
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
							use:enhance={addLoan.enhance}
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
								step="500"
								placeholder="Principal"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<input
								name="installment"
								type="number"
								min="0"
								step="100"
								placeholder="Per period"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<button
								disabled={addLoan.busy}
								class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
								>{addLoan.busy ? 'Adding…' : 'Add Loan'}</button
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
														? 'bg-green-500/15 text-green-400'
														: a.status === 'CANCELLED'
															? 'bg-gray-500/15 text-gray-400'
															: 'bg-blue-500/15 text-blue-400'}">{a.status}</span
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
							use:enhance={addCashAdvance.enhance}
							class="flex flex-wrap items-end gap-2"
						>
							<input
								name="amount"
								type="number"
								min="0"
								step="500"
								placeholder="Amount"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<input
								name="installment"
								type="number"
								min="0"
								step="100"
								placeholder="Per period"
								required
								class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
							/>
							<button
								disabled={addCashAdvance.busy}
								class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
								>{addCashAdvance.busy ? 'Adding…' : 'Add Advance'}</button
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
											<form method="POST" action="?/endEarning" use:enhance={endEarning.enhance}>
												<input type="hidden" name="id" value={e.id} />
												<button
													type="submit"
													disabled={endEarning.busy}
													class="rounded-md border border-red-500/20 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:pointer-events-none disabled:opacity-50"
													>{endEarning.busy ? 'Ending…' : 'End'}</button
												>
											</form>
										{:else}
											<span class="rounded-full bg-gray-500/15 px-2 py-0.5 text-xs text-gray-400"
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
					use:enhance={addEarning.enhance}
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
						step="100"
						placeholder="Monthly amount"
						required
						class="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
					/>
					<button
						disabled={addEarning.busy}
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
						>{addEarning.busy ? 'Adding…' : 'Add'}</button
					>
				</form>
			</section>
		{/if}

		{#if canManage}
			<section class="rounded-lg border bg-card p-6 space-y-4 lg:col-span-2">
				<h2 class="font-semibold">Recurring Deductions</h2>
				<p class="text-xs text-muted-foreground">
					Monthly amounts against a deduction code from Settings &rarr; Pay Codes, prorated to each
					payroll period and taken before loan/cash-advance installments. Ended items stop from the
					next payroll run.
				</p>
				{#if data.recurringDeductions.length}
					<table class="w-full text-sm">
						<tbody class="divide-y">
							{#each data.recurringDeductions as d (d.id)}
								<tr>
									<td class="py-1.5">{d.label ?? d.deductionType.label}</td>
									<td class="py-1.5 text-muted-foreground">{d.deductionType.code}</td>
									<td class="py-1.5 text-right font-mono"
										>{formatCurrency(Number(d.monthlyAmount))}<span
											class="ml-1 text-xs text-muted-foreground">/mo</span
										></td
									>
									<td class="py-1.5 text-right">
										{#if d.isActive}
											<form
												method="POST"
												action="?/endDeduction"
												use:enhance={endDeduction.enhance}
											>
												<input type="hidden" name="id" value={d.id} />
												<button
													type="submit"
													disabled={endDeduction.busy}
													class="rounded-md border border-red-500/20 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:pointer-events-none disabled:opacity-50"
													>{endDeduction.busy ? 'Ending…' : 'End'}</button
												>
											</form>
										{:else}
											<span class="rounded-full bg-gray-500/15 px-2 py-0.5 text-xs text-gray-400"
												>ENDED</span
											>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="text-xs text-muted-foreground">No recurring deductions.</p>
				{/if}
				{#if data.deductionTypes.length}
					<form
						method="POST"
						action="?/addDeduction"
						use:enhance={addDeduction.enhance}
						class="flex flex-wrap items-end gap-2"
					>
						<select
							name="deductionTypeId"
							required
							class="h-8 rounded-md border border-input bg-background px-2 text-xs"
						>
							{#each data.deductionTypes as t (t.id)}
								<option value={t.id}>{t.code} — {t.label}</option>
							{/each}
						</select>
						<input
							name="label"
							placeholder="Label override (optional)"
							class="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<input
							name="monthlyAmount"
							type="number"
							min="0.01"
							step="100"
							placeholder="Monthly amount"
							required
							class="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
						/>
						<button
							disabled={addDeduction.busy}
							class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
							>{addDeduction.busy ? 'Adding…' : 'Add'}</button
						>
					</form>
				{:else}
					<p class="text-xs text-muted-foreground">
						No assignable deduction codes yet — create one under
						<a href="/settings/pay-codes" class="underline">Settings &rarr; Pay Codes</a>.
					</p>
				{/if}
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
												triggerClass="rounded-md border border-red-500/20 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10"
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
					use:enhance={uploadDocument.enhance}
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
						disabled={uploadDocument.busy}
						class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
						>{uploadDocument.busy ? 'Uploading…' : 'Upload'}</button
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
