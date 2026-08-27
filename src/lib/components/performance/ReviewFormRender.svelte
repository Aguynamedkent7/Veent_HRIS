<script lang="ts">
	import type { TemplateStructure } from '$lib/server/performance/types'

	/**
	 * The evaluation form, rendered from a `TemplateStructure`. ONE component, TWO modes (#178).
	 *
	 * - `preview` — the template builder's right-hand pane. Every control is inert and every
	 *   number the evaluator would write is an EMPTY BOX.
	 * - `fill` — the evaluator's real review form (Phase 6).
	 *
	 * It exists in one file on purpose. A preview that is a second, separate approximation of the
	 * review form drifts from it, and a drifting preview is worse than no preview: it teaches HR
	 * to trust a lie about what the form they are composing will look like.
	 *
	 * THE RULE THIS COMPONENT CARRIES: **the app performs NO arithmetic on evaluation scores.**
	 * Weights, section maxima, band ranges and the total ceiling are LABELS this form prints. There
	 * is no sum, no average, no percentage and no derived band anywhere below — not even a
	 * zero-valued placeholder, because a preview showing `0 / 100` teaches HR exactly the wrong
	 * model of who calculates. Subtotals and the total render as empty boxes the evaluator writes
	 * in. The builder's weight hint is deliberately NOT here; it belongs to the builder alone and
	 * must never reach a review.
	 *
	 * PHASE 6 OWNS `fill`: answer binding, `name`/`value` wiring, validation and submit are not
	 * built here. `fill` is structurally complete and inert — the controls render enabled with the
	 * right shapes and ids, and nothing reads or writes them yet.
	 */
	let {
		structure,
		mode = 'preview'
	}: {
		structure: TemplateStructure
		mode?: 'preview' | 'fill'
	} = $props()

	const readonly = $derived(mode === 'preview')

	const inputClass =
		'h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60'
</script>

<!--
	The box the evaluator writes a number into. In `preview` it is EMPTY — never `0`, never a
	computed value. In `fill` Phase 6 replaces it with a bound number input.
-->
{#snippet scoreBox(label: string, ceiling: number | null)}
	<div class="flex items-center justify-between gap-3 border-t pt-2">
		<span class="text-sm font-medium">{label}</span>
		<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
			{#if readonly}
				<span
					class="inline-block h-7 w-20 rounded-md border border-dashed border-input bg-muted/30"
					aria-label="{label} — written in by the evaluator"
				></span>
			{:else}
				<input type="text" inputmode="numeric" aria-label={label} class="h-7 w-20 {inputClass}" />
			{/if}
			{#if ceiling !== null}
				<span class="tabular-nums">/ {ceiling}</span>
			{/if}
		</span>
	</div>
{/snippet}

<div class="space-y-6">
	<!-- Rating scale — printed above the sections, exactly as on the paper form. -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Rating Scale</h3>
		<ul class="divide-y rounded-md border text-sm">
			{#each structure.ratingScale.rows as row (row.value)}
				<li class="flex gap-3 px-3 py-1.5">
					<span class="w-6 shrink-0 font-medium tabular-nums">{row.value}</span>
					<span class="text-muted-foreground">{row.description}</span>
				</li>
			{/each}
		</ul>
	</section>

	<!-- The categories and their criteria. -->
	{#each structure.sections as section, si (section.id)}
		<section class="space-y-2 rounded-lg border p-3">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h3 class="text-sm font-semibold">
					{si + 1}. {section.name || 'Untitled category'}
				</h3>
				{#if section.weightLabel}
					<span class="text-xs text-muted-foreground">Weight {section.weightLabel}</span>
				{/if}
			</div>

			{#if section.criteria.length === 0}
				<p class="text-xs text-muted-foreground">No criteria yet.</p>
			{:else}
				<ul class="space-y-2">
					{#each section.criteria as criterion (criterion.id)}
						<li class="grid gap-2 sm:grid-cols-[1fr_5rem_10rem] sm:items-center">
							<span class="text-sm">{criterion.text || 'Untitled criterion'}</span>
							<input
								type="text"
								inputmode="numeric"
								disabled={readonly}
								placeholder="{structure.ratingScale.min}–{structure.ratingScale.max}"
								aria-label="Rating for {criterion.text || 'this criterion'}"
								class={inputClass}
							/>
							<input
								type="text"
								disabled={readonly}
								placeholder="Remarks"
								aria-label="Remarks for {criterion.text || 'this criterion'}"
								class={inputClass}
							/>
						</li>
					{/each}
				</ul>
			{/if}

			<!--
				The subtotal line exists ONLY when the category declares a maximum. `null` means the
				paper form prints no subtotal for this category (the AE form's Section 3) — rendering
				one anyway would invent a field the evaluator has nowhere to copy from.
			-->
			{#if section.maximum !== null}
				{@render scoreBox('Subtotal', section.maximum)}
			{/if}
		</section>
	{/each}

	<!-- Overall summary — the paper form's recap table. Every cell here is a printed LABEL. -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Overall Summary</h3>
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left text-xs uppercase text-muted-foreground">
					<th class="py-1.5 pr-3 font-medium">Category</th>
					<th class="py-1.5 pr-3 font-medium">Weight</th>
					<th class="py-1.5 font-medium">Score</th>
				</tr>
			</thead>
			<tbody>
				{#each structure.sections as section (section.id)}
					<tr class="border-b last:border-0">
						<td class="py-1.5 pr-3">{section.name || 'Untitled category'}</td>
						<td class="py-1.5 pr-3 text-muted-foreground">{section.weightLabel || '—'}</td>
						<td class="py-1.5">
							{#if readonly}
								<span
									class="inline-block h-7 w-20 rounded-md border border-dashed border-input bg-muted/30"
									aria-label="Score for {section.name ||
										'this category'} — written in by the evaluator"
								></span>
							{:else}
								<input
									type="text"
									inputmode="numeric"
									aria-label="Score for {section.name || 'this category'}"
									class="h-7 w-20 {inputClass}"
								/>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{@render scoreBox('Total Score', structure.totalCeiling)}
	</section>

	<!-- The band is PICKED by the evaluator. It is never looked up from a total. -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Interpretation</h3>
		<select disabled={readonly} aria-label="Interpretation" class="h-9 {inputClass}">
			<option value="">— select —</option>
			{#each structure.interpretationBands as band (band.id)}
				<option value={band.id}>{band.rangeLabel} — {band.label}</option>
			{/each}
		</select>
	</section>

	<!-- Narrative blocks, in array order. -->
	{#each structure.narrativeBlocks as block (block.id)}
		<section class="space-y-1.5">
			<h3 class="text-sm font-semibold">{block.label || 'Untitled block'}</h3>
			<textarea
				rows="3"
				disabled={readonly}
				aria-label={block.label || 'Narrative block'}
				class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
			></textarea>
		</section>
	{/each}

	<!-- A checklist, not a radio group: the paper form allows several at once. -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Recommendation</h3>
		<ul class="space-y-1.5">
			{#each structure.recommendationOptions as option (option.id)}
				<li class="flex flex-wrap items-center gap-2">
					<label class="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							disabled={readonly}
							class="h-4 w-4 rounded border-input disabled:cursor-not-allowed disabled:opacity-60"
						/>
						{option.label || 'Untitled option'}
					</label>
					{#if option.allowsFreeText}
						<input
							type="text"
							disabled={readonly}
							placeholder="Please specify"
							aria-label="{option.label || 'Other'} — details"
							class="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
						/>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<!-- KPI table — present on Admin Staff, absent on Account Executive. `target` is a label. -->
	{#if structure.kpiRows && structure.kpiRows.length > 0}
		<section class="space-y-2">
			<h3 class="text-sm font-semibold">Key Performance Indicators</h3>
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left text-xs uppercase text-muted-foreground">
						<th class="py-1.5 pr-3 font-medium">Indicator</th>
						<th class="py-1.5 pr-3 font-medium">Target</th>
						<th class="py-1.5 font-medium">Actual</th>
					</tr>
				</thead>
				<tbody>
					{#each structure.kpiRows as kpi (kpi.id)}
						<tr class="border-b last:border-0 align-top">
							<td class="py-1.5 pr-3">{kpi.indicator}</td>
							<td class="py-1.5 pr-3 text-muted-foreground">{kpi.target}</td>
							<td class="py-1.5">
								<!-- Free text, typed. NEVER compared to `target`. -->
								<input
									type="text"
									disabled={readonly}
									aria-label="Actual for {kpi.indicator}"
									class={inputClass}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</div>
