<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { fade, scale, slide } from 'svelte/transition'
	import { formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// ─── Review modal ─────────────────────────────────────────────────────────
	type Timesheet = Awaited<PageData['timesheets']>[number]
	type Row = {
		date: string
		timeIn: string
		timeOut: string
		reg: number
		ot: number
		notes: string
	}
	let openTs = $state<Timesheet | null>(null)
	let entries = $state<Row[]>([])
	let rejecting = $state(false)
	let confirmDelete = $state(false)
	let busy = $state(false)
	let dialogEl = $state<HTMLElement>()

	// ─── Bulk selection ─────────────────────────────────────────────────────────
	let selected = $state<string[]>([])
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
	}
	function toggleAll(ids: string[], on: boolean) {
		selected = on ? ids : []
	}
	// Clear the selection after a successful bulk delete.
	const clearOnSuccess: SubmitFunction = () => {
		busy = true
		return async ({ result, update }) => {
			await update()
			busy = false
			if (result.type === 'success') selected = []
		}
	}

	const totalReg = $derived(entries.reduce((s, e) => s + (Number(e.reg) || 0), 0))
	const totalOt = $derived(entries.reduce((s, e) => s + (Number(e.ot) || 0), 0))
	const total = $derived(totalReg + totalOt)
	// Payload sent to the server: total hoursWorked = reg + ot; otHours = ot.
	const entriesPayload = $derived(
		entries.map((e) => ({
			date: e.date,
			timeIn: e.timeIn,
			timeOut: e.timeOut,
			hoursWorked: +(Number(e.reg) + Number(e.ot)).toFixed(2),
			otHours: +Number(e.ot).toFixed(2),
			notes: e.notes
		}))
	)
	const canEdit = $derived(data.isManager && openTs && openTs.status !== 'APPROVED')
	const canReview = $derived(data.isManager && openTs && openTs.status === 'SUBMITTED')
	const canDelete = $derived(data.isManager && openTs)
	const canSubmit = $derived(
		openTs && openTs.employeeId === data.myEmployeeId && openTs.status === 'DRAFT'
	)

	// Lock background scroll + focus the dialog while the modal is open.
	$effect(() => {
		if (!openTs) return
		document.body.style.overflow = 'hidden'
		dialogEl?.focus()
		return () => {
			document.body.style.overflow = ''
		}
	})

	function toDateKey(d: string | Date) {
		return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
	}
	function toTimeInput(d: string | Date | null) {
		if (!d) return ''
		return new Date(d).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: 'Asia/Manila'
		})
	}
	// Regular window is 08:00–17:00; time worked outside it is OT.
	const REG_START = 8 * 60
	const REG_END = 17 * 60
	function recalcRow(row: Row) {
		if (!row.timeIn || !row.timeOut) return
		const [ih, im] = row.timeIn.split(':').map(Number)
		const [oh, om] = row.timeOut.split(':').map(Number)
		let inM = ih * 60 + im
		let outM = oh * 60 + om
		if (outM <= inM) outM += 1440 // overnight
		const worked = outM - inM
		const reg = Math.max(0, Math.min(outM, REG_END) - Math.max(inM, REG_START))
		row.reg = +(reg / 60).toFixed(2)
		row.ot = +((worked - reg) / 60).toFixed(2)
	}
	function openReview(ts: Timesheet) {
		openTs = ts
		rejecting = false
		confirmDelete = false
		entries = ts.entries.map((e) => ({
			date: toDateKey(e.date),
			timeIn: toTimeInput(e.timeIn),
			timeOut: toTimeInput(e.timeOut),
			reg: Number(e.hoursWorked) - Number(e.otHours),
			ot: Number(e.otHours),
			notes: e.notes ?? ''
		}))
	}
	function close() {
		openTs = null
	}
	function addRow() {
		const last = entries.at(-1)
		entries = [
			...entries,
			{
				date: last?.date ?? toDateKey(new Date()),
				timeIn: '',
				timeOut: '',
				reg: 0,
				ot: 0,
				notes: ''
			}
		]
	}
	function removeRow(i: number) {
		entries = entries.filter((_, idx) => idx !== i)
	}

	// Spreadsheet-style keyboard nav across the entry grid.
	// Up/Down (and Enter / Shift+Enter) move between rows; Left/Right jump columns at the
	// text boundary. Date/Time inputs keep their native arrow behaviour (segment editing).
	// selectionStart is null (or throws) on number inputs — treat that as "at the boundary"
	// so Left/Right navigate those cells; text inputs keep caret-boundary behaviour.
	function selStart(el: HTMLInputElement): number | null {
		try {
			return el.selectionStart
		} catch {
			return null
		}
	}
	function atStart(el: HTMLInputElement) {
		const s = selStart(el)
		return s === null || (s === 0 && el.selectionEnd === 0)
	}
	function atEnd(el: HTMLInputElement) {
		const s = selStart(el)
		return s === null || s === el.value.length
	}
	function cellKeydown(e: KeyboardEvent, r: number, c: number) {
		const el = e.currentTarget as HTMLInputElement
		const focusCell = (rr: number, cc: number) => {
			const t = document.querySelector<HTMLInputElement>(`[data-r="${rr}"][data-c="${cc}"]`)
			if (t) {
				e.preventDefault()
				t.focus()
				try {
					t.select()
				} catch {
					/* date/time inputs don't support select() */
				}
			}
		}
		if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) return focusCell(r + 1, c)
		if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) return focusCell(r - 1, c)
		if (el.type === 'date' || el.type === 'time') return // keep native segment arrows
		if (e.key === 'ArrowRight' && atEnd(el)) return focusCell(r, c + 1)
		if (e.key === 'ArrowLeft' && atStart(el)) return focusCell(r, c - 1)
	}

	// Keep the modal's local entry state on save; close it after a review/submit succeeds.
	// `busy` disables the action buttons and guards against double-submits.
	const keepOpen: SubmitFunction = () => {
		busy = true
		return async ({ update }) => {
			await update({ reset: false })
			busy = false
		}
	}
	const closeOnSuccess: SubmitFunction = () => {
		busy = true
		return async ({ result, update }) => {
			await update({ reset: false })
			busy = false
			if (result.type === 'success') close()
		}
	}

	const statusClass: Record<string, string> = {
		APPROVED: 'bg-green-100 text-green-700',
		REJECTED: 'bg-red-100 text-red-700',
		SUBMITTED: 'bg-blue-100 text-blue-700',
		DRAFT: 'bg-gray-100 text-gray-600'
	}
	const inputClass =
		'h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
	const btnPrimary =
		'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
	const btnGhost =
		'rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50'
</script>

<svelte:head>
	<title>Timesheets — Veent HRIS</title>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Timesheets</h1>
		{#if data.myEmployeeId}
			<button
				onclick={() => (showCreate = !showCreate)}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				New Timesheet
			</button>
		{/if}
	</div>

	{#if form?.saved}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-600"
		>
			{form.saved}
		</div>
	{/if}

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
			<h2 class="font-semibold">Create Timesheet</h2>
			<div class="flex items-end gap-4">
				<div>
					<label class="text-sm font-medium">Period Start</label>
					<input name="periodStart" type="date" required class="mt-1 {inputClass} h-9" />
				</div>
				<div>
					<label class="text-sm font-medium">Period End</label>
					<input name="periodEnd" type="date" required class="mt-1 {inputClass} h-9" />
				</div>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create</button
				>
				<button
					type="button"
					onclick={() => (showCreate = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
			</div>
		</form>
	{/if}

	{#await data.timesheets}
		<TableSkeleton rows={5} cols={data.isManager ? 4 : 3} />
	{:then timesheets}
		{@const allIds = timesheets.map((t) => t.id)}
		{@const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id))}
		{@const cols = data.isManager ? 4 : 3}

		<!-- Bulk actions (top-right of the table); appear when rows are selected -->
		{#if selected.length}
			<div
				class="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2"
				transition:slide={{ duration: 120 }}
			>
				<span class="text-sm font-medium">{selected.length} selected</span>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (selected = [])}
						class="mr-1 text-sm text-muted-foreground hover:underline">Clear</button
					>
					{#if data.isManager}
						<form method="POST" action="?/approveMany" use:enhance={clearOnSuccess}>
							<input type="hidden" name="ids" value={selected.join(',')} />
							<button
								disabled={busy}
								class="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
								>Approve selected</button
							>
						</form>
						<form method="POST" action="?/deleteMany" use:enhance={clearOnSuccess}>
							<input type="hidden" name="ids" value={selected.join(',')} />
							<button
								disabled={busy}
								class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
								>Delete selected</button
							>
						</form>
					{:else}
						<form method="POST" action="?/submitMany" use:enhance={clearOnSuccess}>
							<input type="hidden" name="ids" value={selected.join(',')} />
							<button disabled={busy} class={btnPrimary}>Submit selected</button>
						</form>
					{/if}
				</div>
			</div>
		{/if}

		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="w-[1%] px-4 py-3">
							<input
								type="checkbox"
								checked={allSelected}
								onchange={(e) => toggleAll(allIds, e.currentTarget.checked)}
								aria-label="Select all"
								class="align-middle"
							/>
						</th>
						{#if data.isManager}
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						{/if}
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Total Hours</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each timesheets as ts (ts.id)}
						<tr
							onclick={() => openReview(ts)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openReview(ts)}
							tabindex="0"
							class={`cursor-pointer hover:bg-muted/30 focus:bg-muted/40 focus:outline-none ${selected.includes(ts.id) ? 'bg-primary/5' : ''}`}
						>
							<td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={selected.includes(ts.id)}
									onchange={() => toggle(ts.id)}
									aria-label="Select timesheet"
									class="align-middle"
								/>
							</td>
							{#if data.isManager}
								<td class="px-4 py-3">{ts.employee.lastName}, {ts.employee.firstName}</td>
							{/if}
							<td class="px-4 py-3 whitespace-nowrap"
								>{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}</td
							>
							<td class="px-4 py-3">{Number(ts.totalHours).toFixed(2)} hrs</td>
							<td class="px-4 py-3"
								><span
									class={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[ts.status] ?? 'bg-gray-100 text-gray-600'}`}
									>{ts.status}</span
								></td
							>
						</tr>
					{:else}
						<tr>
							<td colspan={cols} class="px-4 py-8 text-center text-muted-foreground"
								>No timesheets found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}
</div>

<!-- ─── Floating review window ──────────────────────────────────────────────── -->
{#if openTs}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		onclick={close}
		role="presentation"
		transition:fade={{ duration: 120 }}
	>
		<div
			bind:this={dialogEl}
			class="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl focus:outline-none"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-label="Timesheet review"
			tabindex="-1"
			transition:scale={{ duration: 150, start: 0.96 }}
		>
			<!-- Header -->
			<div class="flex items-start justify-between gap-4 border-b px-6 py-4">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="truncate text-lg font-bold tracking-tight">
							{openTs.employee.lastName}, {openTs.employee.firstName}
						</h2>
						<span
							class="rounded-full px-2.5 py-0.5 text-xs font-semibold {statusClass[openTs.status] ??
								'bg-gray-100 text-gray-600'}">{openTs.status}</span
						>
					</div>
					<p class="mt-0.5 text-sm text-muted-foreground">
						{formatShortDate(openTs.periodStart)} – {formatShortDate(openTs.periodEnd)}
					</p>
				</div>
				<button
					onclick={close}
					aria-label="Close"
					class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.75"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Body (scrollable) -->
			<div class="flex-1 space-y-4 overflow-y-auto px-6 py-4">
				<!-- Summary -->
				<div class="grid grid-cols-2 gap-3 sm:max-w-lg sm:grid-cols-4">
					<div class="rounded-lg border bg-muted/30 px-4 py-2">
						<p class="text-xs text-muted-foreground">Total</p>
						<p class="font-mono text-lg font-semibold">{total.toFixed(2)}</p>
					</div>
					<div class="rounded-lg border bg-muted/30 px-4 py-2">
						<p class="text-xs text-muted-foreground">Regular</p>
						<p class="font-mono text-lg font-semibold">{totalReg.toFixed(2)}</p>
					</div>
					<div class="rounded-lg border bg-muted/30 px-4 py-2">
						<p class="text-xs text-muted-foreground">Overtime</p>
						<p class="font-mono text-lg font-semibold text-amber-600">{totalOt.toFixed(2)}</p>
					</div>
					<div class="rounded-lg border bg-muted/30 px-4 py-2">
						<p class="text-xs text-muted-foreground">Entries</p>
						<p class="text-lg font-semibold">{canEdit ? entries.length : openTs.entries.length}</p>
					</div>
				</div>

				{#if form?.error}
					<div
						class="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
					>
						{form.error}
					</div>
				{/if}

				{#if openTs.status === 'REJECTED' && openTs.rejectionReason}
					<div class="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm">
						<span class="font-medium text-red-600">Rejection reason:</span>
						{openTs.rejectionReason}
					</div>
				{/if}

				<!-- Entries table -->
				<p class="text-xs text-muted-foreground">
					Regular hours are 8:00 AM–5:00 PM; time worked outside that window is overtime.
				</p>
				<div class="overflow-x-auto rounded-lg border">
					<table class="w-full text-sm">
						<thead class="border-b bg-muted/50">
							<tr>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">In</th>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Out</th>
								<th class="px-3 py-2 text-right font-medium text-muted-foreground">Reg</th>
								<th class="px-3 py-2 text-right font-medium text-muted-foreground">OT</th>
								<th class="px-3 py-2 text-left font-medium text-muted-foreground">Notes</th>
								{#if canEdit}<th class="w-[1%] px-3 py-2"></th>{/if}
							</tr>
						</thead>
						<tbody class="divide-y">
							{#if canEdit}
								{#each entries as row, i (i)}
									<tr>
										<td class="px-3 py-1.5"
											><input
												type="date"
												bind:value={row.date}
												data-r={i}
												data-c={0}
												onkeydown={(e) => cellKeydown(e, i, 0)}
												class={inputClass}
											/></td
										>
										<td class="px-3 py-1.5"
											><input
												type="time"
												bind:value={row.timeIn}
												oninput={() => recalcRow(row)}
												data-r={i}
												data-c={1}
												onkeydown={(e) => cellKeydown(e, i, 1)}
												class={inputClass}
											/></td
										>
										<td class="px-3 py-1.5"
											><input
												type="time"
												bind:value={row.timeOut}
												oninput={() => recalcRow(row)}
												data-r={i}
												data-c={2}
												onkeydown={(e) => cellKeydown(e, i, 2)}
												class={inputClass}
											/></td
										>
										<td class="px-3 py-1.5"
											><input
												type="number"
												step="0.25"
												min="0"
												max="24"
												bind:value={row.reg}
												data-r={i}
												data-c={3}
												onkeydown={(e) => cellKeydown(e, i, 3)}
												class="{inputClass} text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
											/></td
										>
										<td class="px-3 py-1.5"
											><input
												type="number"
												step="0.25"
												min="0"
												max="24"
												bind:value={row.ot}
												data-r={i}
												data-c={4}
												onkeydown={(e) => cellKeydown(e, i, 4)}
												class="{inputClass} text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
											/></td
										>
										<td class="px-3 py-1.5"
											><input
												type="text"
												bind:value={row.notes}
												placeholder="—"
												data-r={i}
												data-c={5}
												onkeydown={(e) => cellKeydown(e, i, 5)}
												class={inputClass}
											/></td
										>
										<td class="px-3 py-1.5 text-right">
											<button
												type="button"
												onclick={() => removeRow(i)}
												aria-label="Remove row"
												class="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													class="h-4 w-4"
													fill="none"
													viewBox="0 0 24 24"
													stroke="currentColor"
													stroke-width="1.75"
													aria-hidden="true"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
													/>
												</svg>
											</button>
										</td>
									</tr>
								{:else}
									<tr
										><td colspan="7" class="px-3 py-6 text-center text-muted-foreground"
											>No entries yet — add a row below.</td
										></tr
									>
								{/each}
							{:else}
								{#each openTs.entries as e (e.id)}
									<tr>
										<td class="px-3 py-1.5 whitespace-nowrap">{formatShortDate(e.date)}</td>
										<td class="px-3 py-1.5 text-muted-foreground"
											>{e.timeIn ? toTimeInput(e.timeIn) : '—'}</td
										>
										<td class="px-3 py-1.5 text-muted-foreground"
											>{e.timeOut ? toTimeInput(e.timeOut) : '—'}</td
										>
										<td class="px-3 py-1.5 text-right font-mono"
											>{(Number(e.hoursWorked) - Number(e.otHours)).toFixed(2)}</td
										>
										<td class="px-3 py-1.5 text-right font-mono">{Number(e.otHours).toFixed(2)}</td>
										<td class="px-3 py-1.5 text-muted-foreground">{e.notes ?? '—'}</td>
									</tr>
								{:else}
									<tr
										><td colspan="6" class="px-3 py-6 text-center text-muted-foreground"
											>No entries recorded.</td
										></tr
									>
								{/each}
							{/if}
						</tbody>
					</table>
				</div>

				{#if canEdit}
					<button
						type="button"
						onclick={addRow}
						class="w-full rounded-lg border border-dashed py-2 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
						>+ Add row</button
					>
				{/if}
			</div>

			<!-- Reject reason panel -->
			{#if canReview && rejecting}
				<div class="border-t bg-red-500/5 px-6 py-3" transition:slide={{ duration: 150 }}>
					<form method="POST" action="?/review" use:enhance={closeOnSuccess}>
						<input type="hidden" name="id" value={openTs.id} />
						<input type="hidden" name="approved" value="false" />
						<label for="reject-reason" class="text-sm font-medium">Reason for rejection</label>
						<textarea
							id="reject-reason"
							name="rejectionReason"
							required
							rows="2"
							placeholder="Explain what needs to change…"
							class="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						></textarea>
						<div class="mt-2 flex gap-2">
							<button
								disabled={busy}
								class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
								>Confirm reject</button
							>
							<button
								type="button"
								onclick={() => (rejecting = false)}
								class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
							>
						</div>
					</form>
				</div>
			{/if}

			<!-- Footer -->
			<div class="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-6 py-3">
				<div>
					{#if canDelete}
						{#if confirmDelete}
							<form
								method="POST"
								action="?/delete"
								use:enhance={closeOnSuccess}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="id" value={openTs.id} />
								<span class="text-sm text-muted-foreground">Delete permanently?</span>
								<button
									disabled={busy}
									class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
									>Yes, delete</button
								>
								<button
									type="button"
									onclick={() => (confirmDelete = false)}
									class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Cancel</button
								>
							</form>
						{:else}
							<button
								type="button"
								onclick={() => (confirmDelete = true)}
								class="text-sm font-medium text-destructive hover:underline">Delete</button
							>
						{/if}
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-2">
					{#if canEdit}
						<form method="POST" action="?/saveEntries" use:enhance={keepOpen}>
							<input type="hidden" name="id" value={openTs.id} />
							<input type="hidden" name="entries" value={JSON.stringify(entriesPayload)} />
							<button disabled={busy} class={btnGhost}>Save entries</button>
						</form>
					{/if}
					{#if canReview && !rejecting}
						<button
							type="button"
							onclick={() => (rejecting = true)}
							class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
							>Reject</button
						>
						<form method="POST" action="?/review" use:enhance={closeOnSuccess}>
							<input type="hidden" name="id" value={openTs.id} />
							<input type="hidden" name="approved" value="true" />
							<button
								disabled={busy}
								class="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
								>Approve</button
							>
						</form>
					{/if}
					{#if canSubmit}
						<form method="POST" action="?/submit" use:enhance={closeOnSuccess}>
							<input type="hidden" name="id" value={openTs.id} />
							<button disabled={busy} class={btnPrimary}>Submit for review</button>
						</form>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
