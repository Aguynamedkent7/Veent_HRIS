<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatDateRange, formatShortDate, formatDate } from '$lib/utils/format'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const req = $derived(data.request)

	// Owner can add/remove documents only while the request can still change.
	const docsEditable = $derived(
		data.isOwner && (req.status === 'PENDING' || req.status === 'RETURNED')
	)
	const fmtSize = (b: number) =>
		b < 1024 * 1024
			? `${Math.max(1, Math.round(b / 1024))} KB`
			: `${(b / 1024 / 1024).toFixed(1)} MB`

	const typeLabels: Record<string, string> = {
		LEAVE: 'Leave',
		OVERTIME: 'Overtime',
		UNDERTIME: 'Undertime',
		OFFICIAL_BUSINESS: 'Official Business',
		REST_DAY_WORK: 'Work on Rest Day',
		HOLIDAY_WORK: 'Holiday Work',
		INFO_UPDATE: 'Info Update'
	}

	function statusClass(s: string) {
		if (s === 'APPROVED') return 'bg-green-100 text-green-700'
		if (s === 'REJECTED') return 'bg-red-100 text-red-700'
		if (s === 'RETURNED') return 'bg-orange-100 text-orange-700'
		if (s === 'CANCELLED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}

	// payload is Json; show only the type-specific extras. Fields already surfaced in
	// their own rows (dates, hours, reason) or that are internal ids are hidden so they
	// don't get dumped raw (e.g. startDate/endDate/leaveTypeId).
	const HIDDEN_PAYLOAD_KEYS = new Set([
		'type',
		'startDate',
		'endDate',
		'date',
		'hours',
		'reason',
		'leaveTypeId'
	])
	const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
	const payloadEntries = $derived(
		Object.entries((req.payload ?? {}) as Record<string, unknown>).filter(
			([k, v]) => !HIDDEN_PAYLOAD_KEYS.has(k) && v != null && v !== ''
		)
	)
	// For Official Business, `reason` mirrors `purpose` (already shown) — don't repeat it.
	const shownPayloadValues = $derived(new Set(payloadEntries.map(([, v]) => String(v))))
	const showReason = $derived(Boolean(req.reason) && !shownPayloadValues.has(String(req.reason)))
	function stageLabel(step: { stageKind: string; role: string | null }) {
		return step.stageKind === 'SUPERVISOR' ? 'Supervisor' : (step.role ?? 'Approver')
	}
</script>

<svelte:head>
	<title>Request — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<BackButton fallback="/requests" label="Requests" />

	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">{typeLabels[req.type] ?? req.type}</h1>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(req.status)}"
			>{req.status}</span
		>
	</div>

	<div class="rounded-lg border bg-card p-4">
		<dl class="grid grid-cols-3 gap-y-2 text-sm">
			<dt class="text-muted-foreground">Employee</dt>
			<dd class="col-span-2">{req.employee.firstName} {req.employee.lastName}</dd>
			{#if data.leaveTypeName}
				<dt class="text-muted-foreground">Leave type</dt>
				<dd class="col-span-2">{data.leaveTypeName}</dd>
			{/if}
			{#if req.dateFrom}
				<dt class="text-muted-foreground">Dates</dt>
				<dd class="col-span-2">{formatDateRange(req.dateFrom, req.dateTo)}</dd>
			{/if}
			{#if req.hours}
				<dt class="text-muted-foreground">Hours</dt>
				<dd class="col-span-2">{req.hours}</dd>
			{/if}
			{#each payloadEntries as [k, v] (k)}
				<dt class="text-muted-foreground">{humanize(k)}</dt>
				<dd class="col-span-2 break-words">{String(v)}</dd>
			{/each}
			{#if showReason}
				<dt class="text-muted-foreground">Reason</dt>
				<dd class="col-span-2">{req.reason}</dd>
			{/if}
			<dt class="text-muted-foreground">Filed</dt>
			<dd class="col-span-2">{formatDate(req.createdAt)}</dd>
		</dl>
	</div>

	<div class="space-y-3">
		<h2 class="text-lg font-semibold">Supporting documents</h2>

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

		{#if req.documents.length === 0}
			<p class="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
				No documents attached.
			</p>
		{:else}
			<ul class="space-y-2">
				{#each req.documents as doc (doc.id)}
					<li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
						<div class="min-w-0 flex-1">
							<a
								href="/api/v1/requests/{req.id}/documents/{doc.id}"
								class="break-words text-sm font-medium text-primary hover:underline"
								download>{doc.label}</a
							>
							<p class="text-xs text-muted-foreground">
								{fmtSize(doc.size)} · uploaded {formatShortDate(doc.uploadedAt)}
							</p>
							{#if doc.verifiedAt}
								<p class="text-xs text-green-700">
									Verified{#if doc.verifiedBy}{' '}by {doc.verifiedBy.email}{/if} · {formatShortDate(
										doc.verifiedAt
									)}
								</p>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-3">
							<span
								class="rounded-full px-2 py-0.5 text-xs font-medium {doc.verifiedAt
									? 'bg-green-100 text-green-700'
									: 'bg-yellow-100 text-yellow-700'}"
							>
								{doc.verifiedAt ? 'Verified' : 'Unverified'}
							</span>
							{#if data.canReview}
								<form method="POST" action="?/verifyDoc" use:enhance>
									<input type="hidden" name="docId" value={doc.id} />
									<input type="hidden" name="verified" value={doc.verifiedAt ? 'false' : 'true'} />
									<button type="submit" class="text-xs text-primary hover:underline">
										{doc.verifiedAt ? 'Unverify' : 'Mark verified'}
									</button>
								</form>
							{/if}
							{#if docsEditable && !doc.verifiedAt}
								<form method="POST" action="?/deleteDoc" use:enhance>
									<input type="hidden" name="docId" value={doc.id} />
									<button type="submit" class="text-xs text-red-600 hover:underline">Remove</button>
								</form>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if docsEditable}
			<form
				method="POST"
				action="?/uploadDocs"
				enctype="multipart/form-data"
				use:enhance
				class="space-y-2 rounded-lg border bg-muted/30 p-3"
			>
				<label for="documents" class="text-xs font-medium">Add documents</label>
				<div class="flex flex-wrap items-center gap-2">
					<input
						id="documents"
						name="documents"
						type="file"
						multiple
						accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
						class="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
					/>
					<button
						type="submit"
						class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>Upload</button
					>
				</div>
				<p class="text-xs text-muted-foreground">
					Up to 5 files per request — PDF, PNG, JPEG or WEBP, max 10 MB each.
				</p>
			</form>
		{/if}
	</div>

	<div class="space-y-3">
		<h2 class="text-lg font-semibold">Approval chain</h2>
		<ol class="space-y-2">
			{#each req.steps as step, i (step.id)}
				{@const active = req.status === 'PENDING' && i === req.currentStage}
				<li
					class="flex items-start gap-3 rounded-lg border p-3 {active
						? 'border-primary/50 bg-primary/5'
						: ''}"
				>
					<div
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium
						{step.decision === 'APPROVED'
							? 'bg-green-100 text-green-700'
							: step.decision === 'REJECTED'
								? 'bg-red-100 text-red-700'
								: step.decision === 'RETURNED'
									? 'bg-orange-100 text-orange-700'
									: 'bg-muted text-muted-foreground'}"
					>
						{i + 1}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">{stageLabel(step)}</p>
						<p class="text-xs text-muted-foreground">
							{#if step.decision}
								{step.decision}{#if step.actor}{' '}
									by {step.actor.email}{/if}{#if step.decidedAt}{' '}
									· {formatShortDate(step.decidedAt)}{/if}
							{:else if active}
								Pending — awaiting decision
							{:else}
								Not yet reached
							{/if}
						</p>
						{#if step.note}<p class="mt-1 text-xs text-muted-foreground">“{step.note}”</p>{/if}
					</div>
				</li>
			{/each}
		</ol>
	</div>
</div>
