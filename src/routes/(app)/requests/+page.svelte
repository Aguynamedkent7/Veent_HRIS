<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import { formatDateRange, formatShortDate } from '$lib/utils/format'
	import { formatDateISO } from '$lib/utils/dates'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const TYPES = [
		{ value: 'LEAVE', label: 'Leave' },
		{ value: 'OVERTIME', label: 'Overtime' },
		{ value: 'UNDERTIME', label: 'Undertime' },
		{ value: 'OFFICIAL_BUSINESS', label: 'Official Business' },
		{ value: 'REST_DAY_WORK', label: 'Work on Rest Day' },
		{ value: 'HOLIDAY_WORK', label: 'Holiday Work' },
		{ value: 'INFO_UPDATE', label: 'Info Update' }
	]
	const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? t

	// Submitted values echoed back by a failed create action — re-populates the form
	// on a non-enhanced (no-JS) rerender; with enhance the browser keeps the inputs,
	// so capturing only the initial value of `form` here is intentional.
	// svelte-ignore state_referenced_locally
	const submitted = (form as { values?: Record<string, string> } | null)?.values

	let selectedType = $state(submitted?.type ?? 'LEAVE')
	let showForm = $state(Boolean(submitted))

	// Per-field validation errors returned by the create action (zod fieldErrors).
	const fieldErrors = $derived(
		(form as { fieldErrors?: Record<string, string[]> } | null)?.fieldErrors
	)
	const fe = (name: string) => fieldErrors?.[name]?.[0]
	const invalid = (name: string) => (fe(name) ? true : undefined)
	const describedBy = (name: string) => (fe(name) ? `${name}-error` : undefined)

	// Date guards: start can't be before today; end can't be before start.
	const today = formatDateISO(new Date())
	let startDate = $state(submitted?.startDate ?? '')

	const isDayHours = (t: string) =>
		['OVERTIME', 'UNDERTIME', 'REST_DAY_WORK', 'HOLIDAY_WORK'].includes(t)

	function statusClass(s: string) {
		if (s === 'APPROVED') return 'bg-green-100 text-green-700'
		if (s === 'REJECTED') return 'bg-red-100 text-red-700'
		if (s === 'RETURNED') return 'bg-orange-100 text-orange-700'
		if (s === 'CANCELLED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}
</script>

<svelte:head>
	<title>My Requests — Veent HRIS</title>
</svelte:head>

{#snippet req()}<span class="text-red-500" aria-hidden="true">*</span>{/snippet}
{#snippet fieldError(name: string)}
	{#if fe(name)}<p id="{name}-error" class="text-xs text-red-600">{fe(name)}</p>{/if}
{/snippet}

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">My Requests</h1>
			<p class="text-sm text-muted-foreground">File and track your requests.</p>
		</div>
		{#if data.hasEmployee}
			<button
				onclick={() => (showForm = !showForm)}
				class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				{showForm ? 'Close' : 'New Request'}
			</button>
		{/if}
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}
	{#if form?.message}
		<div class="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
			{form.message}
		</div>
	{/if}

	{#if !data.hasEmployee}
		<div class="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
			Your account has no employee profile, so you can't file requests.
		</div>
	{/if}

	{#if showForm && data.hasEmployee}
		<form
			method="POST"
			action="?/create"
			enctype="multipart/form-data"
			use:enhance={() =>
				async ({ update, result }) => {
					await update()
					if (result.type === 'success') showForm = false
				}}
			class="space-y-4 rounded-lg border bg-card p-4"
		>
			<div class="grid gap-1.5">
				<label for="type" class="text-sm font-medium">Type</label>
				<select
					id="type"
					name="type"
					bind:value={selectedType}
					class="h-9 rounded-md border border-input bg-background px-3 text-sm"
				>
					{#each TYPES as t (t.value)}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>
			</div>

			{#if selectedType === 'LEAVE'}
				<div class="grid gap-1.5">
					<label for="leaveTypeId" class="text-sm font-medium">Leave type {@render req()}</label>
					<select
						id="leaveTypeId"
						name="leaveTypeId"
						required
						value={submitted?.leaveTypeId ?? data.leaveTypes[0]?.id ?? ''}
						aria-invalid={invalid('leaveTypeId')}
						aria-describedby={describedBy('leaveTypeId')}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					>
						{#each data.leaveTypes as lt (lt.id)}
							<option value={lt.id}>{lt.name}</option>
						{/each}
					</select>
					{@render fieldError('leaveTypeId')}
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<label for="startDate" class="text-sm font-medium">Start {@render req()}</label>
						<input
							id="startDate"
							name="startDate"
							type="date"
							required
							min={today}
							bind:value={startDate}
							aria-invalid={invalid('startDate')}
							aria-describedby={describedBy('startDate')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('startDate')}
					</div>
					<div class="grid gap-1.5">
						<label for="endDate" class="text-sm font-medium">End {@render req()}</label>
						<input
							id="endDate"
							name="endDate"
							type="date"
							required
							min={startDate || today}
							value={submitted?.endDate ?? ''}
							aria-invalid={invalid('endDate')}
							aria-describedby={describedBy('endDate')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('endDate')}
					</div>
				</div>
			{:else if selectedType === 'OFFICIAL_BUSINESS'}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<label for="startDate" class="text-sm font-medium">Start {@render req()}</label>
						<input
							id="startDate"
							name="startDate"
							type="date"
							required
							min={today}
							bind:value={startDate}
							aria-invalid={invalid('startDate')}
							aria-describedby={describedBy('startDate')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('startDate')}
					</div>
					<div class="grid gap-1.5">
						<label for="endDate" class="text-sm font-medium">End {@render req()}</label>
						<input
							id="endDate"
							name="endDate"
							type="date"
							required
							min={startDate || today}
							value={submitted?.endDate ?? ''}
							aria-invalid={invalid('endDate')}
							aria-describedby={describedBy('endDate')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('endDate')}
					</div>
				</div>
				<div class="grid gap-1.5">
					<label for="location" class="text-sm font-medium">Location {@render req()}</label>
					<input
						id="location"
						name="location"
						type="text"
						required
						value={submitted?.location ?? ''}
						aria-invalid={invalid('location')}
						aria-describedby={describedBy('location')}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					/>
					{@render fieldError('location')}
				</div>
				<div class="grid gap-1.5">
					<label for="purpose" class="text-sm font-medium">Purpose {@render req()}</label>
					<input
						id="purpose"
						name="purpose"
						type="text"
						required
						value={submitted?.purpose ?? ''}
						aria-invalid={invalid('purpose')}
						aria-describedby={describedBy('purpose')}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					/>
					{@render fieldError('purpose')}
				</div>
			{:else if isDayHours(selectedType)}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<label for="date" class="text-sm font-medium">Date {@render req()}</label>
						<input
							id="date"
							name="date"
							type="date"
							required
							value={submitted?.date ?? ''}
							aria-invalid={invalid('date')}
							aria-describedby={describedBy('date')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('date')}
					</div>
					<div class="grid gap-1.5">
						<label for="hours" class="text-sm font-medium">Hours {@render req()}</label>
						<input
							id="hours"
							name="hours"
							type="number"
							step="0.25"
							min="0.25"
							max="24"
							required
							value={submitted?.hours ?? ''}
							aria-invalid={invalid('hours')}
							aria-describedby={describedBy('hours')}
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
						{@render fieldError('hours')}
					</div>
				</div>
			{:else if selectedType === 'INFO_UPDATE'}
				<div class="grid gap-1.5">
					<label for="field" class="text-sm font-medium">Field {@render req()}</label>
					<input
						id="field"
						name="field"
						type="text"
						required
						placeholder="e.g. contactAddress"
						value={submitted?.field ?? ''}
						aria-invalid={invalid('field')}
						aria-describedby={describedBy('field')}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					/>
					{@render fieldError('field')}
				</div>
				<div class="grid gap-1.5">
					<label for="requestedValue" class="text-sm font-medium">New value {@render req()}</label>
					<input
						id="requestedValue"
						name="requestedValue"
						type="text"
						required
						value={submitted?.requestedValue ?? ''}
						aria-invalid={invalid('requestedValue')}
						aria-describedby={describedBy('requestedValue')}
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					/>
					{@render fieldError('requestedValue')}
				</div>
			{/if}

			{#if selectedType !== 'OFFICIAL_BUSINESS'}
				<div class="grid gap-1.5">
					<label for="reason" class="text-sm font-medium"
						>Reason <span class="text-muted-foreground">(optional)</span></label
					>
					<textarea
						id="reason"
						name="reason"
						rows="2"
						value={submitted?.reason ?? ''}
						class="rounded-md border border-input bg-background px-3 py-2 text-sm"
					></textarea>
				</div>
			{/if}

			<div class="grid gap-1.5">
				<label for="documents" class="text-sm font-medium"
					>Supporting documents <span class="text-muted-foreground">(optional)</span></label
				>
				<input
					id="documents"
					name="documents"
					type="file"
					multiple
					accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
					class="rounded-md border border-input bg-background px-3 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
				/>
				<p class="text-xs text-muted-foreground">
					Up to 5 files — PDF, PNG, JPEG or WEBP, max 10 MB each.
				</p>
			</div>

			<button
				type="submit"
				class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Submit request
			</button>
		</form>
	{/if}

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Stage</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Filed</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.requests as req (req.id)}
					<tr
						class="cursor-pointer hover:bg-muted/30"
						role="link"
						tabindex="0"
						onclick={(e) => {
							// Let the row's action buttons (Resubmit/Cancel) fire without also navigating.
							if ((e.target as HTMLElement).closest('button, a, form')) return
							goto(`/requests/${req.id}`)
						}}
						onkeydown={(e) => {
							if ((e.target as HTMLElement).closest('button, a, form')) return
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								goto(`/requests/${req.id}`)
							}
						}}
					>
						<td class="px-4 py-3 font-medium">{typeLabel(req.type)}</td>
						<td class="px-4 py-3 text-muted-foreground">
							{#if req.dateFrom}
								{formatDateRange(req.dateFrom, req.dateTo)}
							{:else}
								—
							{/if}
						</td>
						<td class="px-4 py-3 text-muted-foreground">
							{req.status === 'PENDING' ? `${req.currentStage + 1} of ${req.steps.length}` : '—'}
						</td>
						<td class="px-4 py-3">
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {statusClass(req.status)}"
								>{req.status}</span
							>
						</td>
						<td class="px-4 py-3 text-right text-muted-foreground"
							>{formatShortDate(req.createdAt)}</td
						>
						<td class="px-4 py-3 text-right">
							<div class="flex items-center justify-end gap-2">
								{#if req.status === 'RETURNED'}
									<form method="POST" action="?/resubmit" use:enhance>
										<input type="hidden" name="id" value={req.id} />
										<button
											type="submit"
											class="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
											>Resubmit</button
										>
									</form>
								{/if}
								{#if req.status === 'PENDING' || req.status === 'RETURNED'}
									<form method="POST" action="?/cancel" use:enhance>
										<input type="hidden" name="id" value={req.id} />
										<button
											type="submit"
											class="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
											>Cancel</button
										>
									</form>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr
						><td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
							>No requests yet.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</div>
