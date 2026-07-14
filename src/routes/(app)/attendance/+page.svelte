<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const badge: Record<string, string> = {
		PRESENT: 'bg-green-100 text-green-700',
		LATE: 'bg-yellow-100 text-yellow-700',
		ABSENT: 'bg-red-100 text-red-700',
		INCOMPLETE: 'bg-orange-100 text-orange-700',
		ON_LEAVE: 'bg-purple-100 text-purple-700',
		HOLIDAY: 'bg-blue-100 text-blue-700',
		REST_DAY: 'bg-gray-100 text-gray-600'
	}

	const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'INCOMPLETE', 'ON_LEAVE', 'HOLIDAY', 'REST_DAY']

	function fmtDate(d: string | Date) {
		return new Date(d).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
	}
	function fmtTime(d: string | Date | null) {
		if (!d) return '—'
		return new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
	}
	const n = (x: unknown) => Number(x)

	const exportHref = $derived(
		data.view === 'team'
			? `/attendance/export?view=team&date=${data.date}`
			: `/attendance/export?view=employee&employeeId=${data.selectedEmployeeId ?? ''}&from=${data.from}&to=${data.to}`
	)

	// Heroicons (outline, 24×24) — match the inline-SVG convention used in the app nav.
	const IC = {
		refresh:
			'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
		lock: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
		lockOpen:
			'M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
		download:
			'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
		document:
			'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z'
	}
</script>

<svelte:head>
	<title>Attendance — Veent HRIS</title>
</svelte:head>

{#snippet icon(d: string, cls = 'h-4 w-4 shrink-0')}
	<svg xmlns="http://www.w3.org/2000/svg" class={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
		<path stroke-linecap="round" stroke-linejoin="round" d={d} />
	</svg>
{/snippet}

<div class="space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Attendance</h1>
			{#if data.canManage}
				<p class="text-sm text-muted-foreground">Daily records &amp; corrections. For a multi-day team matrix, see Team Attendance.</p>
			{/if}
		</div>
		{#if data.canManage && data.view === 'team'}
			<a href="/team" class="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">Multi-day matrix →</a>
		{/if}
	</div>

	{#if form?.error}
		<div class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400">{form.error}</div>
	{/if}
	{#if form?.saved}
		<div class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600">{form.saved}</div>
	{/if}

	{#if data.canManage}
		<!-- View toggle: one employee's range vs the whole team on a day -->
		<div class="inline-flex rounded-lg border p-1 text-sm">
			<a
				href="?view=employee&employeeId={data.selectedEmployeeId ?? ''}&from={data.from}&to={data.to}"
				class="rounded-md px-3 py-1.5 font-medium {data.view === 'employee' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}"
			>
				By employee
			</a>
			<a
				href="?view=team&date={data.date}"
				class="rounded-md px-3 py-1.5 font-medium {data.view === 'team' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}"
			>
				Whole team (day)
			</a>
		</div>
	{/if}

	<!-- Filters -->
	{#if data.view === 'team'}
		<form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
			<input type="hidden" name="view" value="team" />
			<div class="flex flex-col gap-1">
				<label for="date" class="text-xs font-medium text-muted-foreground">Day</label>
				<input id="date" name="date" type="date" value={data.date} onchange={(e) => e.currentTarget.form?.requestSubmit()} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
		</form>
	{:else}
		<form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
			{#if data.canManage}
				<input type="hidden" name="view" value="employee" />
				<div class="flex flex-col gap-1">
					<label for="employeeId" class="text-xs font-medium text-muted-foreground">Employee</label>
					<select id="employeeId" name="employeeId" onchange={(e) => e.currentTarget.form?.requestSubmit()} class="h-9 rounded-md border border-input bg-background px-3 text-sm">
						{#each data.employees as e (e.id)}
							<option value={e.id} selected={e.id === data.selectedEmployeeId}>{e.lastName}, {e.firstName} ({e.employeeNumber})</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex flex-col gap-1">
				<label for="from" class="text-xs font-medium text-muted-foreground">From</label>
				<input id="from" name="from" type="date" value={data.from} onchange={(e) => e.currentTarget.form?.requestSubmit()} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="to" class="text-xs font-medium text-muted-foreground">To</label>
				<input id="to" name="to" type="date" value={data.to} onchange={(e) => e.currentTarget.form?.requestSubmit()} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
			<p class="w-full text-xs text-muted-foreground">Range is capped at {data.maxRangeDays} days (~2 months); longer spans are trimmed automatically.</p>
		</form>
	{/if}

	<!-- Bulk actions -->
	{#if data.canManage && data.view === 'employee' && data.selectedEmployeeId}
		<div class="flex flex-wrap gap-2">
			<form method="POST" action="?/derive" use:enhance>
				<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
				<input type="hidden" name="from" value={data.from} />
				<input type="hidden" name="to" value={data.to} />
				<button title="Re-pull from punches (updates unlocked days)" class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.refresh)}Refresh</button>
			</form>
			<form method="POST" action="?/lock" use:enhance>
				<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
				<input type="hidden" name="from" value={data.from} />
				<input type="hidden" name="to" value={data.to} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Lock range</button>
			</form>
			{#if data.canUnlock}
				<form method="POST" action="?/unlock" use:enhance>
					<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
					<input type="hidden" name="from" value={data.from} />
					<input type="hidden" name="to" value={data.to} />
					<button title="Reopen locked days (super admin)" class="inline-flex items-center gap-1.5 rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">{@render icon(IC.lockOpen)}Unlock range</button>
				</form>
			{/if}
			<a href={exportHref} class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.download)}Export CSV</a>
			<form method="POST" action="?/saveTimesheet" use:enhance>
				<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
				<input type="hidden" name="from" value={data.from} />
				<input type="hidden" name="to" value={data.to} />
				<button title="Persist this range as a Timesheet record" class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.document)}Save as timesheet</button>
			</form>
		</div>
	{:else if data.canManage && data.view === 'team'}
		<div class="flex flex-wrap gap-2">
			<form method="POST" action="?/deriveTeam" use:enhance>
				<input type="hidden" name="date" value={data.date} />
				<button title="Re-pull from punches (updates unlocked days)" class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.refresh)}Refresh</button>
			</form>
			<form method="POST" action="?/lockTeam" use:enhance>
				<input type="hidden" name="date" value={data.date} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Lock day</button>
			</form>
			{#if data.canUnlock}
				<form method="POST" action="?/unlockTeam" use:enhance>
					<input type="hidden" name="date" value={data.date} />
					<button title="Reopen locked days (super admin)" class="inline-flex items-center gap-1.5 rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">{@render icon(IC.lockOpen)}Unlock day</button>
				</form>
			{/if}
			<a href={exportHref} class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.download)}Export CSV</a>
		</div>
	{:else}
		<!-- Employees can export their own timesheet -->
		<div class="flex gap-2">
			<a href={exportHref} class="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">{@render icon(IC.download)}Export CSV</a>
		</div>
	{/if}

	{#if data.view === 'team'}
		<!-- Team-for-a-day table -->
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Employee</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Department</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">In</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Out</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">Reg</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">OT</th>
						<th class="w-[1%] whitespace-nowrap px-3 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.team as t (t.id)}
						{@const d = t.day}
						{@const editable = data.canManage && d && !d.isLocked}
						<tr class="hover:bg-muted/30 {d && (d.status === 'ABSENT' || d.status === 'INCOMPLETE') ? 'bg-red-500/5' : ''}">
							<td class="px-3 py-2 font-medium whitespace-nowrap">{t.name} <span class="text-xs text-muted-foreground">({t.employeeNumber})</span></td>
							<td class="px-3 py-2 text-muted-foreground">{t.departmentName ?? '—'}</td>
							<td class="px-3 py-2">
								{#if editable && d}
									<select name="status" form="c-{d.id}" class="h-7 rounded border border-input bg-background px-1 text-xs">
										{#each STATUSES as s (s)}<option value={s} selected={s === d.status}>{s}</option>{/each}
									</select>
								{:else if d}
									<span class="rounded-full px-2 py-0.5 text-xs font-medium {badge[d.status] ?? 'bg-gray-100 text-gray-600'}">{d.status}</span>
									{#if d.isLocked}<span title="locked" class="ml-1 inline-flex align-middle text-muted-foreground">{@render icon(IC.lock, 'h-3.5 w-3.5')}</span>{/if}
								{:else}
									<span class="text-xs text-muted-foreground">no record</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.timeIn ?? null)}</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.timeOut ?? null)}</td>
							<td class="px-3 py-2 text-right font-mono">{#if editable && d}<input name="regularHours" form="c-{d.id}" type="number" step="0.25" min="0" value={n(d.regularHours)} class="h-7 w-20 rounded border border-input bg-background px-1 text-right text-xs" />{:else}{d ? n(d.regularHours).toFixed(2) : '—'}{/if}</td>
							<td class="px-3 py-2 text-right font-mono">{#if editable && d}<input name="overtimeHours" form="c-{d.id}" type="number" step="0.25" min="0" value={n(d.overtimeHours)} class="h-7 w-20 rounded border border-input bg-background px-1 text-right text-xs" />{:else}{d ? n(d.overtimeHours).toFixed(2) : '—'}{/if}</td>
							<td class="w-[1%] whitespace-nowrap px-3 py-2">
								{#if editable && d}
									<form id="c-{d.id}" method="POST" action="?/correct" use:enhance>
										<input type="hidden" name="id" value={d.id} />
										<button class="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
									</form>
								{:else if d?.isLocked}
									<span class="inline-flex h-7 items-center text-xs text-muted-foreground">locked</span>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="8" class="px-3 py-8 text-center text-muted-foreground">No active employees.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<!-- Single-employee range table -->
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Date</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">In</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">Out</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">Reg</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">OT</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">Night</th>
						<th class="px-3 py-3 text-right font-medium text-muted-foreground">Late/UT</th>
						{#if data.canManage}<th class="w-[1%] whitespace-nowrap px-3 py-3"></th>{/if}
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.days as d (d.id)}
						{@const editable = data.canManage && !d.isLocked}
						<tr class="hover:bg-muted/30 {d.status === 'ABSENT' || d.status === 'INCOMPLETE' ? 'bg-red-500/5' : ''}">
							<td class="px-3 py-2 whitespace-nowrap">{fmtDate(d.date)} {#if d.isLocked}<span title="locked" class="inline-flex align-middle text-muted-foreground">{@render icon(IC.lock, 'h-3.5 w-3.5')}</span>{/if}</td>
							<td class="px-3 py-2">
								{#if editable}
									<select name="status" form="c-{d.id}" class="h-7 rounded border border-input bg-background px-1 text-xs">
										{#each STATUSES as s (s)}<option value={s} selected={s === d.status}>{s}</option>{/each}
									</select>
								{:else}
									<span class="rounded-full px-2 py-0.5 text-xs font-medium {badge[d.status] ?? 'bg-gray-100 text-gray-600'}">{d.status}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d.timeIn)}</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d.timeOut)}</td>
							<td class="px-3 py-2 text-right font-mono">
								{#if editable}
									<input name="regularHours" form="c-{d.id}" type="number" step="0.25" min="0" value={n(d.regularHours)} class="h-7 w-20 rounded border border-input bg-background px-1 text-right text-xs" />
								{:else}{n(d.regularHours).toFixed(2)}{/if}
							</td>
							<td class="px-3 py-2 text-right font-mono">
								{#if editable}
									<input name="overtimeHours" form="c-{d.id}" type="number" step="0.25" min="0" value={n(d.overtimeHours)} class="h-7 w-20 rounded border border-input bg-background px-1 text-right text-xs" />
								{:else}{n(d.overtimeHours).toFixed(2)}{#if n(d.rawOvertimeHours) > n(d.overtimeHours)}<span class="ml-1 text-xs text-amber-600" title="unapproved OT">(+{(n(d.rawOvertimeHours) - n(d.overtimeHours)).toFixed(1)})</span>{/if}{/if}
							</td>
							<td class="px-3 py-2 text-right font-mono">{n(d.nightDiffHours).toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono text-muted-foreground">{d.lateMinutes}/{d.undertimeMinutes}</td>
							{#if data.canManage}
								<td class="w-[1%] whitespace-nowrap px-3 py-2">
									{#if d.isLocked}
										<span class="inline-flex h-7 items-center text-xs text-muted-foreground">locked</span>
									{:else}
										<form id="c-{d.id}" method="POST" action="?/correct" use:enhance>
											<input type="hidden" name="id" value={d.id} />
											<button class="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
										</form>
									{/if}
								</td>
							{/if}
						</tr>
					{:else}
						<tr><td colspan={data.canManage ? 9 : 8} class="px-3 py-8 text-center text-muted-foreground">No attendance for this range{#if data.canManage} — no punches yet, or use Refresh{/if}.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
