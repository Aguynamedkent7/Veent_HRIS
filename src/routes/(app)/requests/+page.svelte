<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import { formatDateISO } from '$lib/utils/dates'
	import ApprovalCard from '$lib/components/approvals/ApprovalCard.svelte'
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

	let mainTab = $state<'mine' | 'approvals'>('mine')
	let approvalTab = $state<'timesheets' | 'requests'>('timesheets')

	let selectedType = $state('LEAVE')
	let showForm = $state(false)

	// Date guards: start can't be before today; end can't be before start.
	const today = formatDateISO(new Date())
	let startDate = $state('')

	// Per-request note (keyed by request id) — each approval card owns its own note.
	let notes = $state<Record<string, string>>({})
	const noteEmpty = (id: string) => (notes[id] ?? '').trim() === ''

	const isDayHours = (t: string) =>
		['OVERTIME', 'UNDERTIME', 'REST_DAY_WORK', 'HOLIDAY_WORK'].includes(t)

	function statusClass(s: string) {
		if (s === 'APPROVED') return 'bg-green-100 text-green-700'
		if (s === 'REJECTED') return 'bg-red-100 text-red-700'
		if (s === 'RETURNED') return 'bg-orange-100 text-orange-700'
		if (s === 'CANCELLED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}

	function currentStageLabel(r: {
		steps: { stageIndex: number; stageKind: string; role: string | null }[]
		currentStage: number
	}) {
		const step = r.steps.find((s) => s.stageIndex === r.currentStage)
		if (!step) return ''
		return step.stageKind === 'SUPERVISOR' ? 'Supervisor' : (step.role ?? 'Approver')
	}

	const approvalsCount = $derived(data.pendingTimesheets.length + data.pendingRequests.length)
</script>

<svelte:head>
	<title>Requests/Approvals — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Requests/Approvals</h1>
			<p class="text-sm text-muted-foreground">
				File and track your requests{#if data.canApprove}, and act on items awaiting your decision{/if}.
			</p>
		</div>
		{#if mainTab === 'mine' && data.hasEmployee}
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

	<!-- Primary tabs -->
	{#if data.canApprove}
		<div class="flex gap-1 border-b">
			<button
				type="button"
				onclick={() => (mainTab = 'mine')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {mainTab ===
				'mine'
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				My Requests
			</button>
			<button
				type="button"
				onclick={() => (mainTab = 'approvals')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {mainTab ===
				'approvals'
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Approvals
				{#if approvalsCount > 0}
					<span
						class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground"
					>
						{approvalsCount}
					</span>
				{/if}
			</button>
		</div>
	{/if}

	<!-- ─── My Requests ─────────────────────────────────────────────────────── -->
	{#if mainTab === 'mine'}
		{#if !data.hasEmployee}
			<div
				class="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-800"
			>
				Your account has no employee profile, so you can't file requests.
			</div>
		{/if}

		{#if showForm && data.hasEmployee}
			<form
				method="POST"
				action="?/create"
				use:enhance={() =>
					async ({ update }) => {
						await update()
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
						<label for="leaveTypeId" class="text-sm font-medium">Leave type</label>
						<select
							id="leaveTypeId"
							name="leaveTypeId"
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						>
							{#each data.leaveTypes as lt (lt.id)}
								<option value={lt.id}>{lt.name}</option>
							{/each}
						</select>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<label for="startDate" class="text-sm font-medium">Start</label>
							<input
								id="startDate"
								name="startDate"
								type="date"
								min={today}
								bind:value={startDate}
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
						<div class="grid gap-1.5">
							<label for="endDate" class="text-sm font-medium">End</label>
							<input
								id="endDate"
								name="endDate"
								type="date"
								min={startDate || today}
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
					</div>
				{:else if selectedType === 'OFFICIAL_BUSINESS'}
					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<label for="startDate" class="text-sm font-medium">Start</label>
							<input
								id="startDate"
								name="startDate"
								type="date"
								min={today}
								bind:value={startDate}
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
						<div class="grid gap-1.5">
							<label for="endDate" class="text-sm font-medium">End</label>
							<input
								id="endDate"
								name="endDate"
								type="date"
								min={startDate || today}
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
					</div>
					<div class="grid gap-1.5">
						<label for="location" class="text-sm font-medium">Location</label>
						<input
							id="location"
							name="location"
							type="text"
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
					</div>
					<div class="grid gap-1.5">
						<label for="purpose" class="text-sm font-medium">Purpose</label>
						<input
							id="purpose"
							name="purpose"
							type="text"
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
					</div>
				{:else if isDayHours(selectedType)}
					<div class="grid grid-cols-2 gap-3">
						<div class="grid gap-1.5">
							<label for="date" class="text-sm font-medium">Date</label>
							<input
								id="date"
								name="date"
								type="date"
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
						<div class="grid gap-1.5">
							<label for="hours" class="text-sm font-medium">Hours</label>
							<input
								id="hours"
								name="hours"
								type="number"
								step="0.25"
								min="0"
								class="h-9 rounded-md border border-input bg-background px-3 text-sm"
							/>
						</div>
					</div>
				{:else if selectedType === 'INFO_UPDATE'}
					<div class="grid gap-1.5">
						<label for="field" class="text-sm font-medium">Field</label>
						<input
							id="field"
							name="field"
							type="text"
							placeholder="e.g. contactAddress"
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
					</div>
					<div class="grid gap-1.5">
						<label for="requestedValue" class="text-sm font-medium">New value</label>
						<input
							id="requestedValue"
							name="requestedValue"
							type="text"
							class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						/>
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
							class="rounded-md border border-input bg-background px-3 py-2 text-sm"
						></textarea>
					</div>
				{/if}

				<button
					type="submit"
					class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					Submit request
				</button>
			</form>
		{/if}

		<div class="rounded-lg border">
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
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 font-medium"
								><a href="/requests/{req.id}" class="hover:underline">{typeLabel(req.type)}</a></td
							>
							<td class="px-4 py-3 text-muted-foreground">
								{#if req.dateFrom}
									{formatShortDate(req.dateFrom)}{#if req.dateTo && req.dateTo !== req.dateFrom}
										– {formatShortDate(req.dateTo)}{/if}
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
								<div class="flex items-center justify-end gap-3">
									{#if req.status === 'RETURNED'}
										<form method="POST" action="?/resubmit" use:enhance>
											<input type="hidden" name="id" value={req.id} />
											<button type="submit" class="text-xs text-primary hover:underline"
												>Resubmit</button
											>
										</form>
									{/if}
									{#if req.status === 'PENDING' || req.status === 'RETURNED'}
										<form method="POST" action="?/cancel" use:enhance>
											<input type="hidden" name="id" value={req.id} />
											<button type="submit" class="text-xs text-red-600 hover:underline"
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
	{/if}

	<!-- ─── Approvals ───────────────────────────────────────────────────────── -->
	{#if mainTab === 'approvals' && data.canApprove}
		<!-- Sub-tabs -->
		<div class="flex gap-1 border-b">
			<button
				type="button"
				onclick={() => (approvalTab = 'timesheets')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {approvalTab ===
				'timesheets'
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Timesheets
				{#if data.pendingTimesheets.length > 0}
					<span
						class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground"
					>
						{data.pendingTimesheets.length}
					</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={() => (approvalTab = 'requests')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {approvalTab ===
				'requests'
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Requests
				{#if data.pendingRequests.length > 0}
					<span
						class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground"
					>
						{data.pendingRequests.length}
					</span>
				{/if}
			</button>
		</div>

		{#if approvalTab === 'timesheets'}
			{#if data.pendingTimesheets.length === 0}
				<div
					class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm"
				>
					No pending timesheets to review.
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each data.pendingTimesheets as ts (ts.id)}
						<ApprovalCard
							type="timesheet"
							id={ts.id}
							submitterName="{ts.employee.lastName}, {ts.employee.firstName}"
							period="{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}"
							details="{Number(ts.totalHours).toFixed(1)} hrs"
							actionApprove="approveTimesheet"
							actionReject="rejectTimesheet"
						/>
					{/each}
				</div>
			{/if}
		{/if}

		{#if approvalTab === 'requests'}
			{#if data.pendingRequests.length === 0}
				<div
					class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm"
				>
					No requests awaiting your decision.
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each data.pendingRequests as req (req.id)}
						<div class="flex flex-col gap-2 rounded-lg border bg-card p-4">
							<div class="flex items-center justify-between">
								<span class="font-medium">{typeLabel(req.type)}</span>
								<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
									>{currentStageLabel(req)}</span
								>
							</div>
							<p class="text-sm text-muted-foreground">
								{req.employee.lastName}, {req.employee.firstName}
							</p>
							<p class="text-sm">
								{#if req.dateFrom}{formatShortDate(
										req.dateFrom
									)}{#if req.dateTo && req.dateTo !== req.dateFrom}
										– {formatShortDate(req.dateTo)}{/if}{/if}
								{#if req.hours}
									· {req.hours} hrs{/if}
							</p>
							{#if req.reason}<p class="text-xs text-muted-foreground">{req.reason}</p>{/if}
							<a href="/requests/{req.id}" class="text-xs text-primary hover:underline"
								>View detail →</a
							>
							<form
								method="POST"
								action="?/decideRequest"
								use:enhance
								class="mt-1 space-y-2 border-t pt-2"
							>
								<input type="hidden" name="id" value={req.id} />
								<textarea
									name="note"
									rows="1"
									placeholder="Note (required to reject/return)"
									class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
									bind:value={notes[req.id]}
								></textarea>
								<div class="flex gap-2">
									<button
										type="submit"
										name="decision"
										value="APPROVED"
										class="flex-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
										>Approve</button
									>
									<button
										type="submit"
										name="decision"
										value="RETURNED"
										class="flex-1 rounded-md bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
										disabled={noteEmpty(req.id)}>Return</button
									>
									<button
										type="submit"
										name="decision"
										value="REJECTED"
										class="flex-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
										disabled={noteEmpty(req.id)}>Reject</button
									>
								</div>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
