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
</script>

<svelte:head>
	<title>Attendance — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold tracking-tight">Attendance</h1>

	{#if form?.error}
		<div class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400">{form.error}</div>
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
				<input id="date" name="date" type="date" value={data.date} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
			<button type="submit" class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Show</button>
		</form>
	{:else}
		<form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
			{#if data.canManage}
				<input type="hidden" name="view" value="employee" />
				<div class="flex flex-col gap-1">
					<label for="employeeId" class="text-xs font-medium text-muted-foreground">Employee</label>
					<select id="employeeId" name="employeeId" class="h-9 rounded-md border border-input bg-background px-3 text-sm">
						{#each data.employees as e (e.id)}
							<option value={e.id} selected={e.id === data.selectedEmployeeId}>{e.lastName}, {e.firstName} ({e.employeeNumber})</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex flex-col gap-1">
				<label for="from" class="text-xs font-medium text-muted-foreground">From</label>
				<input id="from" name="from" type="date" value={data.from} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
			<div class="flex flex-col gap-1">
				<label for="to" class="text-xs font-medium text-muted-foreground">To</label>
				<input id="to" name="to" type="date" value={data.to} class="h-9 rounded-md border border-input bg-background px-3 text-sm" />
			</div>
			<button type="submit" class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Show</button>
		</form>
	{/if}

	<!-- Bulk actions -->
	{#if data.canManage && data.view === 'employee' && data.selectedEmployeeId}
		<div class="flex gap-2">
			<form method="POST" action="?/derive" use:enhance>
				<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
				<input type="hidden" name="from" value={data.from} />
				<input type="hidden" name="to" value={data.to} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Derive from punches</button>
			</form>
			<form method="POST" action="?/lock" use:enhance>
				<input type="hidden" name="employeeId" value={data.selectedEmployeeId} />
				<input type="hidden" name="from" value={data.from} />
				<input type="hidden" name="to" value={data.to} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Lock range</button>
			</form>
		</div>
	{:else if data.canManage && data.view === 'team'}
		<div class="flex gap-2">
			<form method="POST" action="?/deriveTeam" use:enhance>
				<input type="hidden" name="date" value={data.date} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Derive team from punches</button>
			</form>
			<form method="POST" action="?/lockTeam" use:enhance>
				<input type="hidden" name="date" value={data.date} />
				<button class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Lock day</button>
			</form>
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
						<th class="px-3 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.team as t (t.id)}
						{@const d = t.day}
						<tr class="hover:bg-muted/30 {d && (d.status === 'ABSENT' || d.status === 'INCOMPLETE') ? 'bg-red-500/5' : ''}">
							<td class="px-3 py-2 font-medium whitespace-nowrap">{t.name} <span class="text-xs text-muted-foreground">({t.employeeNumber})</span></td>
							<td class="px-3 py-2 text-muted-foreground">{t.departmentName ?? '—'}</td>
							<td class="px-3 py-2">
								{#if d}
									<span class="rounded-full px-2 py-0.5 text-xs font-medium {badge[d.status] ?? 'bg-gray-100 text-gray-600'}">{d.status}</span>
									{#if d.isLocked}<span title="locked" class="ml-1 text-muted-foreground">🔒</span>{/if}
								{:else}
									<span class="text-xs text-muted-foreground">no record</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.timeIn ?? null)}</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.timeOut ?? null)}</td>
							<td class="px-3 py-2 text-right font-mono">{d ? n(d.regularHours).toFixed(2) : '—'}</td>
							<td class="px-3 py-2 text-right font-mono">{d ? n(d.overtimeHours).toFixed(2) : '—'}</td>
							<td class="px-3 py-2">
								{#if data.canManage && d && !d.isLocked}
									<form method="POST" action="?/correct" use:enhance class="flex items-center gap-1">
										<input type="hidden" name="id" value={d.id} />
										<input name="regularHours" type="number" step="0.25" value={n(d.regularHours)} title="Regular hrs" class="h-7 w-16 rounded border border-input bg-background px-1 text-xs" />
										<input name="overtimeHours" type="number" step="0.25" value={n(d.overtimeHours)} title="Approved OT hrs" class="h-7 w-16 rounded border border-input bg-background px-1 text-xs" />
										<select name="status" class="h-7 rounded border border-input bg-background px-1 text-xs">
											{#each STATUSES as s (s)}<option value={s} selected={s === d.status}>{s}</option>{/each}
										</select>
										<button class="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
									</form>
								{:else if d?.isLocked}
									<span class="text-xs text-muted-foreground">locked</span>
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
						{#if data.canManage}<th class="px-3 py-3"></th>{/if}
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.days as d (d.id)}
						<tr class="hover:bg-muted/30 {d.status === 'ABSENT' || d.status === 'INCOMPLETE' ? 'bg-red-500/5' : ''}">
							<td class="px-3 py-2 whitespace-nowrap">{fmtDate(d.date)} {#if d.isLocked}<span title="locked" class="text-muted-foreground">🔒</span>{/if}</td>
							<td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-xs font-medium {badge[d.status] ?? 'bg-gray-100 text-gray-600'}">{d.status}</span></td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d.timeIn)}</td>
							<td class="px-3 py-2 text-muted-foreground">{fmtTime(d.timeOut)}</td>
							<td class="px-3 py-2 text-right font-mono">{n(d.regularHours).toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono">{n(d.overtimeHours).toFixed(2)}{#if n(d.rawOvertimeHours) > n(d.overtimeHours)}<span class="ml-1 text-xs text-amber-600" title="unapproved OT">(+{(n(d.rawOvertimeHours) - n(d.overtimeHours)).toFixed(1)})</span>{/if}</td>
							<td class="px-3 py-2 text-right font-mono">{n(d.nightDiffHours).toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono text-muted-foreground">{d.lateMinutes}/{d.undertimeMinutes}</td>
							{#if data.canManage}
								<td class="px-3 py-2">
									{#if d.isLocked}
										<span class="text-xs text-muted-foreground">locked</span>
									{:else}
										<form method="POST" action="?/correct" use:enhance class="flex items-center gap-1">
											<input type="hidden" name="id" value={d.id} />
											<input name="regularHours" type="number" step="0.25" value={n(d.regularHours)} title="Regular hrs" class="h-7 w-16 rounded border border-input bg-background px-1 text-xs" />
											<input name="overtimeHours" type="number" step="0.25" value={n(d.overtimeHours)} title="Approved OT hrs" class="h-7 w-16 rounded border border-input bg-background px-1 text-xs" />
											<select name="status" class="h-7 rounded border border-input bg-background px-1 text-xs">
												{#each STATUSES as s (s)}<option value={s} selected={s === d.status}>{s}</option>{/each}
											</select>
											<button class="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Save</button>
										</form>
									{/if}
								</td>
							{/if}
						</tr>
					{:else}
						<tr><td colspan={data.canManage ? 9 : 8} class="px-3 py-8 text-center text-muted-foreground">No attendance for this range. {#if data.canManage}Click "Derive from punches".{/if}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
