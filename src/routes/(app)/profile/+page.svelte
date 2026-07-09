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

<div class="space-y-6">
	<div class="page-header">
		<h1 class="page-title">My Profile</h1>
	</div>

	{#if form?.success}
		<div class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-400">
			Profile updated successfully.
		</div>
	{/if}

	{#if form?.error}
		<div class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Employment Details (read-only) -->
		<section class="card space-y-5">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Employment Details</h2>
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
			<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Personal &amp; Contact</h2>
			<form method="POST" action="?/update" use:enhance class="space-y-4">
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<label for="firstName" class="text-xs font-medium text-muted-foreground">First Name</label>
						<input
							id="firstName"
							name="firstName"
							type="text"
							value={emp.firstName}
							class="input"
						/>
					</div>
					<div class="space-y-1.5">
						<label for="lastName" class="text-xs font-medium text-muted-foreground">Last Name</label>
						<input
							id="lastName"
							name="lastName"
							type="text"
							value={emp.lastName}
							class="input"
						/>
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
					<label for="contactAddress" class="text-xs font-medium text-muted-foreground">Address</label>
					<textarea
						id="contactAddress"
						name="contactAddress"
						rows="2"
						class="input h-auto resize-none py-2"
					>{emp.contactAddress ?? ''}</textarea>
				</div>

				<div class="space-y-1.5">
					<label for="dateOfBirth" class="text-xs font-medium text-muted-foreground">Date of Birth</label>
					<input
						id="dateOfBirth"
						name="dateOfBirth"
						type="date"
						value={emp.dateOfBirth ? new Date(emp.dateOfBirth).toISOString().slice(0, 10) : ''}
						class="input"
					/>
				</div>

				<div class="pt-2">
					<button type="submit" class="btn-primary">
						Save Changes
					</button>
				</div>
			</form>
		</section>
	</div>
</div>
