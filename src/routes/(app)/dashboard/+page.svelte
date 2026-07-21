<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import NewTimesheetDialog from '$lib/components/timesheets/NewTimesheetDialog.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const metrics = $derived(data.metrics)
	let showPost = $state(false)
	// #108: a double-click posts the announcement twice to the whole organisation.
	const postAnnouncement = createSubmitGuard(() => async ({ update }) => {
		await update()
		showPost = false
	})
	let showNewTimesheet = $state(false)
</script>

<svelte:head>
	<title>Dashboard — Veent HRIS</title>
</svelte:head>

<div class="space-y-8">
	<div class="page-header">
		<h1 class="page-title">Dashboard</h1>
	</div>

	<!-- Metric cards — each one drills down to its module page (#53) -->
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<a
			href="/employees"
			class="card flex flex-col gap-3 transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Active Employees
			</p>
			<p class="text-4xl font-bold text-foreground">{metrics.headcount}</p>
			<p class="text-xs text-muted-foreground">across your organisation</p>
		</a>

		<a
			href="/leave"
			class="card flex flex-col gap-3 transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				On Leave Today
			</p>
			<p
				class="text-4xl font-bold {metrics.onLeaveToday > 0
					? 'text-yellow-400'
					: 'text-foreground'}"
			>
				{metrics.onLeaveToday}
			</p>
			<p class="text-xs text-muted-foreground">employees on approved leave</p>
		</a>

		<a
			href="/requests"
			class="card flex flex-col gap-3 transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Pending Approvals
			</p>
			<p
				class="text-4xl font-bold {metrics.pendingApprovals > 0
					? 'text-blue-400'
					: 'text-foreground'}"
			>
				{metrics.pendingApprovals}
			</p>
			<p class="text-xs text-muted-foreground">
				{metrics.pendingRequests} requests · {metrics.pendingTimesheets} timesheets · {metrics.pendingPayrollRuns}
				payroll
			</p>
		</a>

		{#if data.canViewPayroll}
			<a
				href="/payroll"
				class="card flex flex-col gap-3 transition-colors hover:border-primary/40 hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					Last Payroll
				</p>
				{#if metrics.lastPayrollRun}
					<p class="text-3xl font-bold text-foreground">
						{formatCurrency(Number(metrics.lastPayrollRun.totalNet))}
					</p>
					<p class="flex items-center gap-2 text-xs text-muted-foreground">
						<span>{formatShortDate(metrics.lastPayrollRun.periodEnd)}</span>
						<span class="badge-{metrics.lastPayrollRun.status === 'APPROVED' ? 'green' : 'yellow'}">
							{metrics.lastPayrollRun.status}
						</span>
					</p>
				{:else}
					<p class="text-2xl font-semibold text-muted-foreground/60">—</p>
					<p class="text-xs text-muted-foreground">no payroll runs yet</p>
				{/if}
			</a>
		{/if}
	</div>

	<!-- Attendance summary (today) -->
	<div class="card space-y-3">
		<div class="flex items-center justify-between">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Attendance Today
			</p>
			<a href="/attendance" class="text-xs text-primary hover:underline">Open attendance →</a>
		</div>
		{#if metrics.attendance.derived > 0}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div>
					<p class="text-3xl font-bold text-green-500">{metrics.attendance.present}</p>
					<p class="text-xs text-muted-foreground">Present</p>
				</div>
				<div>
					<p class="text-3xl font-bold text-yellow-400">{metrics.attendance.late}</p>
					<p class="text-xs text-muted-foreground">Late</p>
				</div>
				<div>
					<p class="text-3xl font-bold text-red-400">{metrics.attendance.absent}</p>
					<p class="text-xs text-muted-foreground">Absent</p>
				</div>
				<div>
					<p class="text-3xl font-bold text-blue-400">{metrics.attendance.onLeave}</p>
					<p class="text-xs text-muted-foreground">On Leave</p>
				</div>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">
				No attendance derived for today yet. Derive it from the <a
					href="/attendance"
					class="text-primary hover:underline">Attendance</a
				> page.
			</p>
		{/if}
	</div>

	<!-- Announcements -->
	<div class="card space-y-3">
		<div class="flex items-center justify-between">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Announcements
			</p>
			{#if data.canPost}
				<button
					type="button"
					onclick={() => (showPost = !showPost)}
					class="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
					>{showPost ? 'Cancel' : 'Post'}</button
				>
			{/if}
		</div>

		{#if form?.posted}
			<div
				class="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400"
			>
				Announcement posted.
			</div>
		{/if}

		{#if showPost && data.canPost}
			<form
				method="POST"
				action="?/postAnnouncement"
				use:enhance={postAnnouncement.enhance}
				class="space-y-2 rounded-md border p-3"
			>
				{#if form?.error}<p class="text-xs text-red-400">{form.error}</p>{/if}
				<input name="title" placeholder="Title" required class="input h-9" />
				<textarea
					name="body"
					rows="2"
					placeholder="Message to the whole organisation…"
					required
					class="input h-auto resize-none py-2"
				></textarea>
				<button
					type="submit"
					disabled={postAnnouncement.busy}
					class="btn-primary text-sm disabled:pointer-events-none disabled:opacity-50"
					>{postAnnouncement.busy ? 'Posting…' : 'Post announcement'}</button
				>
			</form>
		{/if}

		{#if data.announcements.length}
			<ul class="divide-y">
				{#each data.announcements as a (a.id)}
					<li class="py-2.5">
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-sm font-medium text-foreground">{a.title}</p>
							<span class="shrink-0 text-xs text-muted-foreground"
								>{formatShortDate(a.createdAt)}</span
							>
						</div>
						<p class="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-muted-foreground">No announcements yet.</p>
		{/if}
	</div>

	<!-- Quick actions -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<a
			href="/employees/new"
			class="card group flex items-center gap-4 transition-colors hover:border-primary/40 hover:bg-card/80"
		>
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
					/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">Onboard Employee</p>
				<p class="text-xs text-muted-foreground">Add a new team member</p>
			</div>
		</a>

		<button
			type="button"
			onclick={() => (showNewTimesheet = true)}
			class="card group flex items-center gap-4 text-left transition-colors hover:border-primary/40 hover:bg-card/80"
		>
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
					/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">Log Timesheet</p>
				<p class="text-xs text-muted-foreground">Submit this week's hours</p>
			</div>
		</button>

		<a
			href="/leave/new"
			class="card group flex items-center gap-4 transition-colors hover:border-primary/40 hover:bg-card/80"
		>
			<div
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400 group-hover:bg-yellow-500/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
					/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">File Leave</p>
				<p class="text-xs text-muted-foreground">Submit a leave request</p>
			</div>
		</a>
	</div>
</div>

<NewTimesheetDialog bind:open={showNewTimesheet} />
