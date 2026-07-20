<script lang="ts">
	import { enhance } from '$app/forms'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// #108: a double-click here would create a duplicate employee + user + welcome email.
	const create = createSubmitGuard()
</script>

<svelte:head>
	<title>New Employee — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Onboard New Employee</h1>
		<a href="/employees" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</a>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			{typeof form.error === 'string' ? form.error : 'Please fix the errors below.'}
		</div>
	{/if}

	<form method="POST" action="?/create" use:enhance={create.enhance} class="space-y-8">
		<!-- Personal Information -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Personal Information</legend>
			<div class="grid gap-4 sm:grid-cols-3">
				<div>
					<label for="firstName" class="text-sm font-medium"
						>First Name <span class="text-destructive">*</span></label
					>
					<input
						id="firstName"
						name="firstName"
						required
						value={form?.values?.firstName ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.firstName}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.firstName[0]}</p>
					{/if}
				</div>
				<div>
					<label for="lastName" class="text-sm font-medium"
						>Last Name <span class="text-destructive">*</span></label
					>
					<input
						id="lastName"
						name="lastName"
						required
						value={form?.values?.lastName ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.lastName}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.lastName[0]}</p>
					{/if}
				</div>
				<div>
					<label for="middleName" class="text-sm font-medium">Middle Name</label>
					<input
						id="middleName"
						name="middleName"
						value={form?.values?.middleName ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
		</fieldset>

		<!-- Contact Information -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Contact Information</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="contactPhone" class="text-sm font-medium">Phone</label>
					<input
						id="contactPhone"
						name="contactPhone"
						type="tel"
						value={form?.values?.contactPhone ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="contactAddress" class="text-sm font-medium">Address</label>
					<input
						id="contactAddress"
						name="contactAddress"
						value={form?.values?.contactAddress ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
		</fieldset>

		<!-- Account -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Account</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="email" class="text-sm font-medium"
						>Email <span class="text-destructive">*</span></label
					>
					<input
						id="email"
						name="email"
						type="email"
						required
						value={form?.values?.email ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.email}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.email[0]}</p>
					{/if}
				</div>
				<div>
					<label for="password" class="text-sm font-medium">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						placeholder="Leave blank to auto-generate"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<p class="mt-1 text-xs text-muted-foreground">
						If left blank, a temporary password will be generated and emailed.
					</p>
				</div>
				<div>
					<label for="role" class="text-sm font-medium"
						>Role <span class="text-destructive">*</span></label
					>
					<select
						id="role"
						name="role"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="EMPLOYEE">Employee</option>
						<option value="MANAGER">Manager</option>
						<option value="HR_ADMIN">HR Admin</option>
					</select>
				</div>
				<div>
					<label for="discordId" class="text-sm font-medium">Discord ID</label>
					<input
						id="discordId"
						name="discordId"
						value={form?.values?.discordId ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<p class="mt-1 text-xs text-muted-foreground">
						Links this employee to the Discord time-tracking bot. In Discord: Developer Mode →
						right-click the user → Copy User ID. Optional — can be set later.
					</p>
					{#if form?.fieldErrors?.discordId}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.discordId[0]}</p>
					{/if}
				</div>
			</div>
		</fieldset>

		<!-- Employment -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Employment Details</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="departmentId" class="text-sm font-medium"
						>Department <span class="text-destructive">*</span></label
					>
					<select
						id="departmentId"
						name="departmentId"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="">Select department…</option>
						{#each data.departments as dept (dept.id)}
							<option value={dept.id}>{dept.name}</option>
						{/each}
					</select>
					{#if form?.fieldErrors?.departmentId}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.departmentId[0]}</p>
					{/if}
				</div>
				<div>
					<label for="jobTitle" class="text-sm font-medium"
						>Job Title <span class="text-destructive">*</span></label
					>
					<input
						id="jobTitle"
						name="jobTitle"
						required
						value={form?.values?.jobTitle ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.jobTitle}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.jobTitle[0]}</p>
					{/if}
				</div>
				<div>
					<label for="employmentType" class="text-sm font-medium"
						>Employment Type <span class="text-destructive">*</span></label
					>
					<select
						id="employmentType"
						name="employmentType"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="FULL_TIME">Full Time</option>
						<option value="PROBATIONARY">Probationary</option>
						<option value="CONTRACTUAL">Contractual</option>
						<option value="PART_TIME">Part-time</option>
					</select>
				</div>
				<div>
					<label for="startDate" class="text-sm font-medium"
						>Start Date <span class="text-destructive">*</span></label
					>
					<input
						id="startDate"
						name="startDate"
						type="date"
						required
						value={form?.values?.startDate ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.startDate}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.startDate[0]}</p>
					{/if}
				</div>
				<div>
					<label for="basicMonthlySalary" class="text-sm font-medium"
						>Basic Monthly Salary (PHP) <span class="text-destructive">*</span></label
					>
					<input
						id="basicMonthlySalary"
						name="basicMonthlySalary"
						type="number"
						min="0"
						step="1000"
						required
						value={form?.values?.basicMonthlySalary ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{#if form?.fieldErrors?.basicMonthlySalary}
						<p class="mt-1 text-xs text-destructive">{form.fieldErrors.basicMonthlySalary[0]}</p>
					{/if}
				</div>
				<div>
					<label for="reportsToId" class="text-sm font-medium">Reports To</label>
					<select
						id="reportsToId"
						name="reportsToId"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="">None</option>
						{#each data.employees as emp (emp.id)}
							<option value={emp.id}>{emp.lastName}, {emp.firstName}</option>
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
						<option value="">None</option>
						{#each data.positions as pos (pos.id)}
							<option value={pos.id} selected={form?.values?.positionId === pos.id}
								>{pos.title}</option
							>
						{/each}
					</select>
				</div>
				<div>
					<label for="workScheduleId" class="text-sm font-medium">Work Schedule</label>
					<select
						id="workScheduleId"
						name="workScheduleId"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="">None</option>
						{#each data.workSchedules as ws (ws.id)}
							<option
								value={ws.id}
								selected={form?.values?.workScheduleId
									? form.values.workScheduleId === ws.id
									: ws.isDefault}>{ws.name}</option
							>
						{/each}
					</select>
					<p class="mt-1 text-xs text-muted-foreground">
						Attendance derivation uses this schedule — set it now or the new hire's days won't
						compute until it's assigned.
					</p>
				</div>
			</div>
		</fieldset>

		<!-- Government IDs -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Government IDs</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="sssNumber" class="text-sm font-medium">SSS Number</label>
					<input
						id="sssNumber"
						name="sssNumber"
						value={form?.values?.sssNumber ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="philhealthNumber" class="text-sm font-medium">PhilHealth Number</label>
					<input
						id="philhealthNumber"
						name="philhealthNumber"
						value={form?.values?.philhealthNumber ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="pagibigNumber" class="text-sm font-medium">Pag-IBIG Number</label>
					<input
						id="pagibigNumber"
						name="pagibigNumber"
						value={form?.values?.pagibigNumber ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="tinNumber" class="text-sm font-medium">TIN Number</label>
					<input
						id="tinNumber"
						name="tinNumber"
						value={form?.values?.tinNumber ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
		</fieldset>

		<!-- Emergency Contact -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Emergency Contact</legend>
			<div class="grid gap-4 sm:grid-cols-3">
				<div>
					<label for="emergencyContactName" class="text-sm font-medium">Contact Name</label>
					<input
						id="emergencyContactName"
						name="emergencyContactName"
						value={form?.values?.emergencyContactName ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="emergencyContactRelation" class="text-sm font-medium">Relationship</label>
					<input
						id="emergencyContactRelation"
						name="emergencyContactRelation"
						value={form?.values?.emergencyContactRelation ?? ''}
						placeholder="e.g. Spouse, Parent"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="emergencyContactPhone" class="text-sm font-medium">Contact Phone</label>
					<input
						id="emergencyContactPhone"
						name="emergencyContactPhone"
						value={form?.values?.emergencyContactPhone ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
		</fieldset>

		<!-- Bank / GCash Details -->
		<fieldset class="rounded-md border p-4 space-y-4">
			<legend class="px-1 text-sm font-semibold">Bank / GCash Details</legend>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="bankName" class="text-sm font-medium">Bank</label>
					<input
						id="bankName"
						name="bankName"
						value={form?.values?.bankName ?? ''}
						placeholder="e.g. BDO, BPI"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="bankAccountName" class="text-sm font-medium">Account Name</label>
					<input
						id="bankAccountName"
						name="bankAccountName"
						value={form?.values?.bankAccountName ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="bankAccountNumber" class="text-sm font-medium">Account Number</label>
					<input
						id="bankAccountNumber"
						name="bankAccountNumber"
						value={form?.values?.bankAccountNumber ?? ''}
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="gcashNumber" class="text-sm font-medium">GCash Number</label>
					<input
						id="gcashNumber"
						name="gcashNumber"
						value={form?.values?.gcashNumber ?? ''}
						placeholder="e.g. 0917xxxxxxx"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
		</fieldset>

		<div class="flex justify-end gap-3">
			<a href="/employees" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</a>
			<button
				type="submit"
				disabled={create.busy}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
			>
				{create.busy ? 'Creating…' : 'Create Employee'}
			</button>
		</div>
	</form>
</div>
