<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import ApprovalCard from '$lib/components/approvals/ApprovalCard.svelte'
	import Skeleton from '$lib/components/ui/Skeleton.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let activeTab = $state<'timesheets' | 'leave' | 'requests'>('timesheets')

	const typeLabels: Record<string, string> = {
		LEAVE: 'Leave', OVERTIME: 'Overtime', UNDERTIME: 'Undertime',
		OFFICIAL_BUSINESS: 'Official Business', REST_DAY_WORK: 'Work on Rest Day',
		HOLIDAY_WORK: 'Holiday Work', INFO_UPDATE: 'Info Update'
	}
	function currentStageLabel(r: { steps: { stageIndex: number; stageKind: string; role: string | null }[]; currentStage: number }) {
		const step = r.steps.find((s) => s.stageIndex === r.currentStage)
		if (!step) return ''
		return step.stageKind === 'SUPERVISOR' ? 'Supervisor' : (step.role ?? 'Approver')
	}
</script>

<svelte:head>
	<title>Approvals — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Approvals</h1>
	</div>

	{#await data.pending}
		<div class="flex gap-3 border-b pb-2">
			<Skeleton class="h-5 w-24" />
			<Skeleton class="h-5 w-16" />
		</div>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each Array.from({ length: 3 }) as _, i (i)}
				<Skeleton class="h-28 w-full" />
			{/each}
		</div>
	{:then { timesheets: pendingTimesheets, leave: pendingLeave }}
		<!-- Tab navigation -->
		<div class="flex gap-1 border-b">
			<button
				type="button"
				onclick={() => (activeTab = 'timesheets')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'timesheets' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Timesheets
				{#if pendingTimesheets.length > 0}
					<span class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
						{pendingTimesheets.length}
					</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={() => (activeTab = 'leave')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'leave' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Leave
				{#if pendingLeave.length > 0}
					<span class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
						{pendingLeave.length}
					</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={() => (activeTab = 'requests')}
				class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'requests' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				Requests
				{#if data.pendingRequests.length > 0}
					<span class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
						{data.pendingRequests.length}
					</span>
				{/if}
			</button>
		</div>

		<!-- Timesheets tab -->
		{#if activeTab === 'timesheets'}
			{#if pendingTimesheets.length === 0}
				<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
					No pending timesheets to review.
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each pendingTimesheets as ts (ts.id)}
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

		<!-- Leave tab -->
		{#if activeTab === 'leave'}
			{#if pendingLeave.length === 0}
				<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
					No pending leave requests to review.
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each pendingLeave as req (req.id)}
						<ApprovalCard
							type="leave"
							id={req.id}
							submitterName="{req.employee.lastName}, {req.employee.firstName}"
							period="{formatShortDate(req.startDate)} – {formatShortDate(req.endDate)}"
							details="{Number(req.totalDays)} days – {req.leaveType.name}"
							actionApprove="approveLeave"
							actionReject="rejectLeave"
						/>
					{/each}
				</div>
			{/if}
		{/if}

		<!-- Requests tab -->
		{#if activeTab === 'requests'}
			{#if data.pendingRequests.length === 0}
				<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
					No requests awaiting your decision.
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each data.pendingRequests as req (req.id)}
						<div class="flex flex-col gap-2 rounded-lg border bg-card p-4">
							<div class="flex items-center justify-between">
								<span class="font-medium">{typeLabels[req.type] ?? req.type}</span>
								<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{currentStageLabel(req)}</span>
							</div>
							<p class="text-sm text-muted-foreground">{req.employee.lastName}, {req.employee.firstName}</p>
							<p class="text-sm">
								{#if req.dateFrom}{formatShortDate(req.dateFrom)}{#if req.dateTo && req.dateTo !== req.dateFrom} – {formatShortDate(req.dateTo)}{/if}{/if}
								{#if req.hours} · {req.hours} hrs{/if}
							</p>
							{#if req.reason}<p class="text-xs text-muted-foreground">{req.reason}</p>{/if}
							<a href="/requests/{req.id}" class="text-xs text-primary hover:underline">View detail →</a>
							<form method="POST" action="?/decideRequest" use:enhance class="mt-1 space-y-2 border-t pt-2">
								<input type="hidden" name="id" value={req.id} />
								<textarea name="note" rows="1" placeholder="Note (required to reject/return)" class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"></textarea>
								<div class="flex gap-2">
									<button type="submit" name="decision" value="APPROVED" class="flex-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700">Approve</button>
									<button type="submit" name="decision" value="RETURNED" class="flex-1 rounded-md bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600">Return</button>
									<button type="submit" name="decision" value="REJECTED" class="flex-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">Reject</button>
								</div>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/await}
</div>
