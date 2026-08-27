<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import ReviewFormRender from '$lib/components/performance/ReviewFormRender.svelte'
	import { answerDraft, serialiseAnswers } from '$lib/components/performance/answer-draft'
	import { addToast } from '$lib/stores/toast.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	/**
	 * The evaluator's real review form (#178 item 131) — the surface this whole feature exists to
	 * produce. It renders the review's OWN snapshotted template through
	 * `ReviewFormRender.svelte` in `fill` mode. The template builder's preview pane renders the
	 * SAME component in `preview` mode, which is the point: two renderers would drift, and a
	 * drifting preview teaches HR a lie about the form they are composing.
	 *
	 * THE RULE THIS PAGE CARRIES: **the app performs NO arithmetic on evaluation scores.** The
	 * evaluator types every rating, every subtotal and the overall total, and picks the band.
	 * Weights, maxima and band ranges are labels. Nothing here sums, averages or derives — see the
	 * comment above the section loop in `ReviewFormRender.svelte`, and plan §0.
	 */
	let { data, form }: { data: PageData; form: ActionData } = $props()
	const r = $derived(data.review)

	// The draft the evaluator types into. Read from `data` ONCE on purpose: re-deriving it would
	// throw away unsaved typing on every invalidation. `null` only when the snapshot is unreadable,
	// in which case the page renders a banner instead of a form.
	// svelte-ignore state_referenced_locally
	let draft = $state(data.structure ? answerDraft(data.structure, data.review.answers) : null)

	// ── Validation errors, routed to the row that caused them ──────────────────
	// `?/submitScores` returns zod's dotted paths (`criteria.crit_x.rating`,
	// `sectionSubtotals.sec_y`, `totalScore`). A single banner on a 60-input form is not usable, so
	// each row asks for its own path — the same shape the template builder uses.
	const issues = $derived(
		form && 'issues' in form && form.issues
			? (form.issues as { path: string; message: string }[])
			: []
	)

	/** The issue belonging to `prefix` itself or to one of its own fields — not to a nested list. */
	function errorAt(prefix: string): string | undefined {
		for (const issue of issues) {
			if (issue.path === prefix) return issue.message
			if (issue.path.startsWith(`${prefix}.`)) {
				const rest = issue.path.slice(prefix.length + 1)
				if (!rest.includes('.')) return issue.message
			}
		}
		return undefined
	}

	// #108: double-submitting these re-writes the review.
	const saveSelf = createSubmitGuard()
	const saveComments = createSubmitGuard()
	const submitScores = createSubmitGuard(() => async ({ result, update }) => {
		// `reset: false` — the inputs are bound to `draft`, and a native form reset would blank the
		// DOM without telling Svelte, leaving what is shown and what would be posted disagreeing.
		await update({ reset: false })
		if (result.type === 'success') addToast('Scores submitted.', { kind: 'success' })
	})

	// The reviewer keeps the form editable until the review is closed out. The server is the
	// authority on this (`submitScores` re-checks the reviewer itself); this only decides what is
	// worth showing. Phase 7 tightens it once sign-off starts.
	const canScore = $derived(
		data.isReviewer && r.status !== 'COMPLETED' && r.status !== 'ACKNOWLEDGED'
	)
	// The subject sees nothing evaluator-authored: `redactHrAuthored` nulls `answers` before it
	// leaves the server, so there is nothing to render even if this branch were wrong.
	const subjectOnly = $derived(data.isSubject && !data.isReviewer)

	function statusClass(s: string) {
		if (s === 'ACKNOWLEDGED') return 'bg-green-500/15 text-green-400'
		if (s === 'COMPLETED') return 'bg-blue-500/15 text-blue-400'
		if (s === 'PENDING') return 'bg-gray-500/15 text-gray-400'
		return 'bg-yellow-500/15 text-yellow-400'
	}
</script>

<svelte:head>
	<title>Performance Review — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 flex-1 space-y-1">
			<h1 class="text-2xl font-bold tracking-tight">
				{r.employee.firstName}
				{r.employee.lastName}
			</h1>
			<p class="text-sm text-muted-foreground">
				{r.cycle.name} · Reviewer: {r.reviewer.firstName}
				{r.reviewer.lastName}
			</p>
		</div>
		<div
			class="ml-auto flex basis-full shrink-0 flex-wrap items-center justify-end gap-2 sm:basis-auto"
		>
			<BackButton fallback="/performance" label="Performance" />
			<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(r.status)}"
				>{r.status.replace('_', ' ')}</span
			>
		</div>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400"
			role="alert"
		>
			{form.error}
		</div>
	{/if}

	<!-- Self-assessment — employee-authored, its own column, never inside `answers`. -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Self-Assessment</h2>
		{#if data.isSubject && (r.status === 'PENDING' || r.status === 'SELF_ASSESSMENT')}
			<form method="POST" action="?/saveSelf" use:enhance={saveSelf.enhance} class="space-y-2">
				<label class="sr-only" for="selfAssessment">Self-assessment</label>
				<textarea
					id="selfAssessment"
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

	<!-- The evaluation itself. -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Evaluation</h2>

		<!--
			ITEM 130's FLAG, BRANCHED ON FIRST. A review whose snapshot is missing or unreadable gets
			a banner INSTEAD of the form — never a half-rendered one. An empty form would be filled in
			and signed as though it were the real one.
		-->
		{#if data.structureError || !draft || !data.structure}
			<div class="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3">
				<p class="text-sm font-semibold text-destructive">This evaluation cannot be opened</p>
				<p class="text-sm text-muted-foreground">
					{data.structureError ??
						'This review has no readable evaluation form — its stored template is missing or in an unreadable shape. Ask HR to reopen the review.'}
				</p>
			</div>
		{:else if canScore}
			<form
				method="POST"
				action="?/submitScores"
				use:enhance={submitScores.enhance}
				class="space-y-4"
			>
				<!--
					ONE field carrying the whole §4.2 answers object as JSON — the contract
					`?/submitScores` reads. The visible inputs deliberately carry no `name`, so nothing
					is posted twice and there is one parse and one failure mode.
				-->
				<input type="hidden" name="answers" value={serialiseAnswers(draft)} />
				<ReviewFormRender structure={data.structure} mode="fill" answers={draft} {errorAt} />
				<div class="flex items-center gap-3 border-t pt-3">
					<button
						disabled={submitScores.busy}
						class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
						>{submitScores.busy ? 'Submitting…' : 'Submit scores'}</button
					>
					<p class="text-sm text-muted-foreground">
						You type every number. Veent HRIS does not calculate any of them.
					</p>
				</div>
			</form>
		{:else if subjectOnly}
			<!--
				The redacted case: `answers` arrives as `null` for the subject, so there is nothing to
				render. Say so plainly rather than showing an empty form that reads as "not scored".
			-->
			<p class="text-sm text-muted-foreground">
				This evaluation is confidential while it is being completed. HR releases it to you once it
				is finished, and you can leave your comments below.
			</p>
		{:else if r.answers}
			<!-- Read-back: the same form, the stored values, no typing. -->
			<ReviewFormRender structure={data.structure} mode="fill" answers={draft} {errorAt} disabled />
		{:else}
			<p class="text-sm text-muted-foreground">Not scored yet.</p>
		{/if}
	</section>

	<!-- Employee comments — employee-authored, its own column, ALWAYS visible to the employee. -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Employee Comments</h2>
		{#if data.isSubject && r.status !== 'ACKNOWLEDGED'}
			<form
				method="POST"
				action="?/saveEmployeeComments"
				use:enhance={saveComments.enhance}
				class="space-y-2"
			>
				<label class="sr-only" for="employeeComments">Employee comments</label>
				<textarea
					id="employeeComments"
					name="employeeComments"
					rows="4"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>{r.employeeComments ?? ''}</textarea
				>
				<button
					disabled={saveComments.busy}
					class="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
					>{saveComments.busy ? 'Saving…' : 'Save comments'}</button
				>
			</form>
		{:else if r.employeeComments}
			<p class="whitespace-pre-line text-sm text-muted-foreground">{r.employeeComments}</p>
		{:else}
			<p class="text-sm text-muted-foreground">None yet.</p>
		{/if}
	</section>

	<!--
		Reviews written before #178 still hold their old two columns. Nothing writes them any more
		(item 125 deleted `submitManagerReview`), and the subject never receives them — but HR must
		still be able to read what is already on the record.
	-->
	{#if !subjectOnly && (r.managerComments || r.overallRating != null)}
		<section class="space-y-2 rounded-lg border bg-card p-4">
			<h2 class="font-semibold">Manager Review (before the template form)</h2>
			{#if r.managerComments}
				<p class="whitespace-pre-line text-sm text-muted-foreground">{r.managerComments}</p>
			{/if}
			{#if r.overallRating != null}
				<p class="text-sm font-medium">Rating: {r.overallRating}/5</p>
			{/if}
		</section>
	{/if}
</div>
