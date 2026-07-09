<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const emp = $derived(data.employee)
</script>

<svelte:head>
	<title>My Profile — Veent HRIS</title>
</svelte:head>

<div class="space-y-8 max-w-2xl">
	<h1 class="text-2xl font-bold tracking-tight">My Profile</h1>

	{#if form?.success}
		<div class="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
			Profile updated successfully.
		</div>
	{/if}

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<!-- Employment Details (read-only) -->
	<section class="rounded-lg border p-5 space-y-4">
		<h2 class="text-base font-semibold">Employment Details</h2>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
			<div>
				<dt class="text-muted-foreground">Employee Number</dt>
				<dd class="font-medium mt-0.5">{emp.employeeNumber}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Job Title</dt>
				<dd class="font-medium mt-0.5">{emp.jobTitle}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Department</dt>
				<dd class="font-medium mt-0.5">{emp.department?.name ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Employment Type</dt>
				<dd class="font-medium mt-0.5">{emp.employmentType}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Start Date</dt>
				<dd class="font-medium mt-0.5">{formatDate(emp.startDate)}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Reports To</dt>
				<dd class="font-medium mt-0.5">
					{#if emp.reportsTo}
						{emp.reportsTo.lastName}, {emp.reportsTo.firstName}
					{:else}
						—
					{/if}
				</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Email</dt>
				<dd class="font-medium mt-0.5">{emp.user.email}</dd>
			</div>
			<div>
				<dt class="text-muted-foreground">Status</dt>
				<dd class="mt-0.5">
					<span class="rounded-full px-2 py-0.5 text-xs font-medium {emp.employmentStatus === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
						{emp.employmentStatus}
					</span>
				</dd>
			</div>
		</dl>
	</section>

	<!-- Personal & Contact (editable) -->
	<section class="rounded-lg border p-5 space-y-4">
		<h2 class="text-base font-semibold">Personal &amp; Contact</h2>
		<form method="POST" action="?/update" use:enhance class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-1">
					<label for="firstName" class="text-sm font-medium">First Name</label>
					<input
						id="firstName"
						name="firstName"
						type="text"
						value={emp.firstName}
						class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div class="space-y-1">
					<label for="lastName" class="text-sm font-medium">Last Name</label>
					<input
						id="lastName"
						name="lastName"
						type="text"
						value={emp.lastName}
						class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>

			<div class="space-y-1">
				<label for="contactPhone" class="text-sm font-medium">Phone</label>
				<input
					id="contactPhone"
					name="contactPhone"
					type="tel"
					value={emp.contactPhone ?? ''}
					class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>

			<div class="space-y-1">
				<label for="contactAddress" class="text-sm font-medium">Address</label>
				<textarea
					id="contactAddress"
					name="contactAddress"
					rows="2"
					class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
				>{emp.contactAddress ?? ''}</textarea>
			</div>

			<div class="space-y-1">
				<label for="dateOfBirth" class="text-sm font-medium">Date of Birth</label>
				<input
					id="dateOfBirth"
					name="dateOfBirth"
					type="date"
					value={emp.dateOfBirth ? new Date(emp.dateOfBirth).toISOString().slice(0, 10) : ''}
					class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>

			<div class="pt-1">
				<button
					type="submit"
					class="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					Save Changes
				</button>
			</div>
		</form>
	</section>
</div>
