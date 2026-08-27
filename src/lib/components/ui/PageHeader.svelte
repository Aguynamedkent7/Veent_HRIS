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
		/**
		 * Legacy slot. Page actions now belong on the first section's heading row, not here —
		 * see the layout rule below. Still rendered for the pages not yet moved across.
		 */
		actions?: Snippet
		/** A BackButton, rendered on the right edge of the title row — the side opposite the sidebar. */
		back?: Snippet
	} = $props()
</script>

<!-- Title-row rule: the title, its description and the Back link, nothing else. Page actions
     move DOWN to the heading row of the first section they act on (right-aligned, level with
     that heading), so Back is the only thing a thumb can hit on the title line and each action
     sits beside the thing it changes. `ml-auto` keeps the Back cluster flush right on whatever
     line it lands on, and below `sm` it takes a full-width row of its own so a long title is
     never squeezed against it. The `actions` snippet is the pre-rule path and is still rendered
     after Back for the pages not yet moved across. -->
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
