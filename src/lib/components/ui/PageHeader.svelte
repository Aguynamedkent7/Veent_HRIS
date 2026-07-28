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
		/** A BackButton, rendered above the title where a page is reached from another. */
		back?: Snippet
	} = $props()
</script>

<div class="space-y-1">
	{#if back}
		{@render back()}
	{/if}
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
			{#if description}
				<p class="max-w-2xl text-sm text-muted-foreground">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>
		{/if}
	</div>
</div>
