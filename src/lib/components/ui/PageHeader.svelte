<script lang="ts">
	import type { Snippet } from 'svelte'

	// One page title treatment for every route. Before this the app carried six different
	// `<h1>` class strings across 52 pages and `.page-header` was used on two of them, so the
	// heading size and the gap under it drifted page to page.
	let {
		title,
		description,
		actions,
		back
	}: {
		title: string
		/** One line under the title. Say what the page is for, not what it is called. */
		description?: string
		/** Buttons or links, right-aligned on desktop and wrapping under the title on mobile. */
		actions?: Snippet
		/** A BackButton, rendered on the right edge of the title row — the side opposite the sidebar. */
		back?: Snippet
	} = $props()
</script>

<!-- Back-vs-actions rule: one right-aligned cluster holds both, back FIRST and the page actions
     after it, so the primary action stays nearest the right edge and Back never sits under a
     thumb aimed at Save/Delete. `ml-auto` keeps the cluster flush right on whatever line it
     lands on, and below `sm` it takes a full-width row of its own so a long title is never
     squeezed against the buttons. -->
<div class="flex flex-wrap items-start justify-between gap-3">
	<div class="min-w-0 flex-1 space-y-1">
		<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
		{#if description}
			<p class="max-w-2xl text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if back || actions}
		<div
			class="ml-auto flex basis-full shrink-0 flex-wrap items-center justify-end gap-2 sm:basis-auto"
		>
			{#if back}
				{@render back()}
			{/if}
			{#if actions}
				{@render actions()}
			{/if}
		</div>
	{/if}
</div>
