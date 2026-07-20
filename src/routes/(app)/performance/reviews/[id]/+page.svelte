<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { formatShortDate } from '$lib/utils/format'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const r = $derived(data.review)

	// #108: double-submitting these re-writes the review or re-runs the acknowledge transition.
	const saveSelf = createSubmitGuard()
	const submitReview = createSubmitGuard()
	const acknowledge = createSubmitGuard()

	function statusClass(s: string) {
		if (s === 'ACKNOWLEDGED') return 'bg-green-100 text-green-700'
		if (s === 'COMPLETED') return 'bg-blue-100 text-blue-700'
		if (s === 'PENDING') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}
</script>

<svelte:head>
	<title>Performance Review — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<BackButton fallback="/performance" label="Performance" />

	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">
				{r.employee.firstName}
				{r.employee.lastName}
			</h1>
			<p class="text-sm text-muted-foreground">
				{r.cycle.name} · Reviewer: {r.reviewer.firstName}
				{r.reviewer.lastName}
			</p>
		</div>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(r.status)}"
			>{r.status.replace('_', ' ')}</span
		>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<!-- Self-assessment -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Self-Assessment</h2>
		{#if data.isSubject && (r.status === 'PENDING' || r.status === 'SELF_ASSESSMENT')}
			<form method="POST" action="?/saveSelf" use:enhance={saveSelf.enhance} class="space-y-2">
				<textarea
					name="selfAssessment"
					rows="4"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>{r.selfAssessment ?? ''}</textarea
				>
				<button
					disabled={saveSelf.busy}
					class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{saveSelf.busy ? 'Saving…' : 'Save self-assessment'}</button
				>
			</form>
		{:else if r.selfAssessment}
			<p class="whitespace-pre-line text-sm text-muted-foreground">{r.selfAssessment}</p>
		{:else}
			<p class="text-sm text-muted-foreground">Not submitted yet.</p>
		{/if}
	</section>

	<!-- Manager review -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Manager Review</h2>
		{#if data.isReviewer && r.status !== 'ACKNOWLEDGED'}
			<form
				method="POST"
				action="?/submitReview"
				use:enhance={submitReview.enhance}
				class="space-y-2"
			>
				<textarea
					name="managerComments"
					rows="4"
					placeholder="Comments"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>{r.managerComments ?? ''}</textarea
				>
				<div class="flex items-center gap-2">
					<label for="rating" class="text-sm">Overall rating (1–5)</label>
					<input
						id="rating"
						name="overallRating"
						type="number"
						min="1"
						max="5"
						value={r.overallRating ?? ''}
						class="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm"
					/>
				</div>
				<button
					disabled={submitReview.busy}
					class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{submitReview.busy ? 'Submitting…' : 'Submit review'}</button
				>
			</form>
		{:else if r.managerComments || r.overallRating != null}
			<p class="whitespace-pre-line text-sm text-muted-foreground">{r.managerComments ?? ''}</p>
			{#if r.overallRating != null}<p class="text-sm font-medium">
					Rating: {r.overallRating}/5
				</p>{/if}
		{:else}
			<p class="text-sm text-muted-foreground">Awaiting manager review.</p>
		{/if}
	</section>

	<!-- Acknowledge -->
	{#if data.isSubject && r.status === 'COMPLETED'}
		<form method="POST" action="?/acknowledge" use:enhance={acknowledge.enhance}>
			<button
				disabled={acknowledge.busy}
				class="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:pointer-events-none disabled:opacity-50"
				>{acknowledge.busy ? 'Acknowledging…' : 'Acknowledge review'}</button
			>
		</form>
	{:else if r.status === 'ACKNOWLEDGED'}
		<p class="text-sm text-green-700">
			✓ Acknowledged{#if r.acknowledgedAt}
				on {formatShortDate(r.acknowledgedAt)}{/if}.
		</p>
	{/if}
</div>
