<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const { employee } = data
	const canManage = $derived(data.canManage)
</script>

<svelte:head>
	<title>{employee.lastName}, {employee.firstName} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		<a href="/employees" class="text-sm text-muted-foreground hover:text-foreground">← Employees</a>
		<h1 class="text-2xl font-bold">{employee.lastName}, {employee.firstName}</h1>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {employee.employmentStatus === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
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
					<dd class="font-medium">{formatCurrency(Number(employee.basicMonthlySalary))}/mo</dd>
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
			<form method="POST" action="?/update" use:enhance class="rounded-lg border p-6 space-y-4 lg:col-span-2">
				<h2 class="font-semibold">Update Profile</h2>
				<div class="grid gap-3 sm:grid-cols-3">
					<div>
						<label class="text-sm font-medium">Job Title</label>
						<input name="jobTitle" value={employee.jobTitle} class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
					</div>
					<div>
						<label class="text-sm font-medium">Department</label>
						<select name="departmentId" class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
							{#each data.departments as dept (dept.id)}
								<option value={dept.id} selected={dept.id === employee.departmentId}>{dept.name}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="text-sm font-medium">Basic Monthly Salary</label>
						<input name="basicMonthlySalary" type="number" value={Number(employee.basicMonthlySalary)} class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
					</div>
				</div>
				<div class="flex justify-end">
					<button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Save Changes</button>
				</div>
			</form>

			<form method="POST" action="?/offboard" use:enhance class="rounded-lg border border-destructive/50 p-6 space-y-4">
				<h2 class="font-semibold text-destructive">Offboard Employee</h2>
				<div class="flex items-end gap-4">
					<div>
						<label class="text-sm font-medium">Last Day</label>
						<input name="endDate" type="date" required class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
					</div>
					<button type="submit" class="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Offboard</button>
				</div>
			</form>
		{/if}
	</div>
</div>
