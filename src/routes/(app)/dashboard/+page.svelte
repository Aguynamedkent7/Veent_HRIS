<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import { tenureLabel } from '$lib/utils/dates'
	import { employmentTypeLabel, contractRenewalStatus } from '$lib/utils/employment'
	import NewTimesheetDialog from '$lib/components/timesheets/NewTimesheetDialog.svelte'
	import AnnouncementItem from '$lib/components/dashboard/AnnouncementItem.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const metrics = $derived(data.metrics)
	let showPost = $state(false)

	// Per-posting guards + a reject-note toggle for the approval card (#195).
	const decideGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const decideGuard = (id: string) => (decideGuards[id] ??= createSubmitGuard())
	let rejectingId = $state<string | null>(null)

	// Today's birthday greeting, rendered at the top of the announcements feed (#167).
	const birthdayBody = $derived.by(() => {
		const names = data.birthdays
		if (!names.length) return ''
		const verb = names.length === 1 ? 'celebrates' : 'celebrate'
		const list =
			names.length === 1
				? names[0]
				: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
		return `${list} ${verb} their birthday today. Wishing you the best!`
	})
	const hasFeed = $derived(
		data.announcements.length > 0 || data.birthdays.length > 0 || data.awards.length > 0
	)

	// The viewer's own employment standing for the status card (#167).
	const status = $derived(data.myStatus)
	const renewal = $derived(
		status?.employmentType === 'CONTRACTUAL' && status.endDate
			? contractRenewalStatus(new Date(status.endDate))
			: null
	)
	// #108: a double-click posts the announcement twice to the whole organisation.
	const postAnnouncement = createSubmitGuard(() => async ({ update }) => {
		await update()
		showPost = false
	})
	// Give-award form (#180).
	let showAward = $state(false)
	const giveAward = createSubmitGuard(() => async ({ update }) => {
		await update()
		showAward = false
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

	<!-- Employee's own status: type, tenure, and renewal for contractual (#167) -->
	{#if status}
		<div class="card space-y-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				My Status
			</p>
			<div class="flex flex-wrap items-center gap-x-8 gap-y-3">
				<div>
					<p class="text-xs text-muted-foreground">Employment</p>
					<span
						class="mt-1 inline-block rounded-full px-2.5 py-0.5 text-sm font-medium {status.employmentType ===
						'FULL_TIME'
							? 'bg-green-500/15 text-green-400'
							: status.employmentType === 'PROBATIONARY'
								? 'bg-yellow-500/15 text-yellow-400'
								: status.employmentType === 'CONTRACTUAL'
									? 'bg-blue-500/15 text-blue-400'
									: 'bg-gray-500/15 text-gray-300'}"
					>
						{employmentTypeLabel(status.employmentType)}
					</span>
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Tenure</p>
					<p class="mt-1 text-sm font-medium">{tenureLabel(new Date(status.startDate))}</p>
					<p class="text-xs text-muted-foreground">since {formatShortDate(status.startDate)}</p>
				</div>
				{#if renewal}
					<div>
						<p class="text-xs text-muted-foreground">Contract renewal</p>
						<p
							class="mt-1 text-sm font-medium {renewal.expired
								? 'text-red-400'
								: renewal.dueForRenewal
									? 'text-amber-500'
									: 'text-foreground'}"
						>
							{renewal.expired
								? `Expired ${formatShortDate(status.endDate!)}`
								: renewal.dueForRenewal
									? `Up for renewal — in ${renewal.daysUntil} day${renewal.daysUntil === 1 ? '' : 's'}`
									: `Ends ${formatShortDate(status.endDate!)}`}
						</p>
						{#if !renewal.expired && !renewal.dueForRenewal}
							<p class="text-xs text-muted-foreground">in {renewal.daysUntil} days</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Upcoming regularizations — HR's advance warning (#168) -->
	{#if data.canPost && data.regularizations.length}
		<div class="card space-y-3 border-amber-500/30 bg-amber-500/5">
			<div class="flex items-center gap-2">
				<svg
					class="h-4 w-4 text-amber-500"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path
						d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
					/>
				</svg>
				<p class="text-xs font-semibold uppercase tracking-widest text-amber-500">
					Upcoming Regularizations
				</p>
			</div>
			<p class="text-xs text-muted-foreground">
				Probationary staff becoming regular within the next three weeks — decide before the date
				lands.
			</p>
			<ul class="divide-y divide-border/60">
				{#each data.regularizations as r (r.id)}
					<li class="flex items-center justify-between gap-3 py-2">
						<div class="min-w-0">
							<a href="/employees/{r.id}" class="font-medium hover:underline">{r.name}</a>
							<p class="truncate text-xs text-muted-foreground">{r.jobTitle} · {r.department}</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="text-sm">{formatShortDate(r.regularizationDate)}</p>
							<p class="text-xs font-medium {r.overdue ? 'text-red-400' : 'text-amber-500'}">
								{r.overdue
									? `Overdue by ${-r.daysUntil} day${r.daysUntil === -1 ? '' : 's'}`
									: r.daysUntil === 0
										? 'Regularizes today'
										: `in ${r.daysUntil} day${r.daysUntil === 1 ? '' : 's'}`}
							</p>
						</div>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Job postings awaiting your approval (#195) -->
	{#if data.postingsToApprove.length}
		<div class="card space-y-3 border-blue-500/30 bg-blue-500/5">
			<p class="text-xs font-semibold uppercase tracking-widest text-blue-400">
				Postings awaiting your approval
			</p>
			<ul class="divide-y divide-border/60">
				{#each data.postingsToApprove as p (p.id)}
					{@const g = decideGuard(p.id)}
					<li class="space-y-2 py-2">
						<div class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">{p.title}</p>
								<p class="truncate text-xs text-muted-foreground">{p.department}</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<form method="POST" action="?/decidePosting" use:enhance={g.enhance}>
									<input type="hidden" name="id" value={p.id} />
									<input type="hidden" name="action" value="approve" />
									<button
										type="submit"
										disabled={g.busy}
										class="rounded-md border border-green-500/30 px-3 py-1 text-xs font-medium text-green-400 hover:bg-green-500/10 disabled:pointer-events-none disabled:opacity-50"
										>{g.busy ? '…' : 'Approve'}</button
									>
								</form>
								<button
									type="button"
									onclick={() => (rejectingId = rejectingId === p.id ? null : p.id)}
									class="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent"
									>Send back</button
								>
							</div>
						</div>
						{#if rejectingId === p.id}
							<form
								method="POST"
								action="?/decidePosting"
								use:enhance={g.enhance}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="action" value="reject" />
								<input
									name="note"
									required
									placeholder="Reason to send back to draft…"
									class="h-8 flex-1 rounded border border-input bg-background px-2 text-xs"
								/>
								<button
									type="submit"
									disabled={g.busy}
									class="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
									>Confirm</button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Recent activity — payslips, request outcomes, etc. (#169) -->
	{#if data.recentActivity.length}
		<div class="card space-y-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Recent Activity
			</p>
			<ul class="divide-y divide-border/60">
				{#each data.recentActivity as n (n.id)}
					<li class="flex items-center justify-between gap-3 py-2">
						<div class="flex min-w-0 items-center gap-2">
							{#if !n.readAt}
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="unread"
								></span>
							{/if}
							{#if n.link}
								<a href={n.link} class="truncate text-sm hover:underline">{n.message}</a>
							{:else}
								<span class="truncate text-sm">{n.message}</span>
							{/if}
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">{formatShortDate(n.createdAt)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Attendance summary (today) -->
	<div class="card space-y-3">
		<div class="flex items-center justify-between">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
				Attendance Today
			</p>
			<a href="/attendance" class="btn-row">Open attendance</a>
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
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => (showAward = !showAward)}
						class="rounded-md border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-500 hover:bg-amber-500/10"
						>{showAward ? 'Cancel' : 'Give award'}</button
					>
					<button
						type="button"
						onclick={() => (showPost = !showPost)}
						class="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
						>{showPost ? 'Cancel' : 'Post'}</button
					>
				</div>
			{/if}
		</div>

		{#if form?.posted}
			<div
				class="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400"
			>
				Announcement posted.
			</div>
		{/if}
		{#if form?.awarded}
			<div
				class="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-500"
			>
				Award given.
			</div>
		{/if}

		{#if showAward && data.canPost}
			<form
				method="POST"
				action="?/giveAward"
				use:enhance={giveAward.enhance}
				class="space-y-2 rounded-md border p-3"
			>
				{#if form?.error}<p class="text-xs text-red-400">{form.error}</p>{/if}
				<div class="grid gap-2 sm:grid-cols-2">
					<select name="employeeId" required class="input h-9">
						<option value="">Select employee…</option>
						{#each data.awardEmployees as e (e.id)}
							<option value={e.id}>{e.lastName}, {e.firstName}</option>
						{/each}
					</select>
					<input name="title" placeholder="Award (e.g. Employee of the Month)" required class="input h-9" />
				</div>
				<input name="note" placeholder="Note (optional)" class="input h-9" />
				<button
					type="submit"
					disabled={giveAward.busy}
					class="btn-primary text-sm disabled:pointer-events-none disabled:opacity-50"
					>{giveAward.busy ? 'Giving…' : 'Give award'}</button
				>
			</form>
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

		{#if hasFeed}
			<ul class="divide-y">
				{#if data.birthdays.length}
					<AnnouncementItem variant="birthday" title="Happy Birthday!" body={birthdayBody} />
				{/if}
				{#each data.awards as aw (aw.id)}
					<AnnouncementItem
						variant="award"
						title={`${aw.employeeName} — ${aw.title}`}
						body={aw.note ?? undefined}
						timestamp={aw.createdAt}
					/>
				{/each}
				{#each data.announcements as a (a.id)}
					<AnnouncementItem title={a.title} body={a.body} timestamp={a.createdAt} />
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
