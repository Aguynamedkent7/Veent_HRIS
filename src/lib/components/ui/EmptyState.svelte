<script lang="ts">
	import type { Snippet } from 'svelte'

	// Replaces 31 improvised "no rows" cells carrying 18+ different wordings, some ending in a
	// period, some not, most offering no way forward.
	//
	// The `variant` split is the point: "nothing here yet" and "your filter matched nothing" are
	// different situations and must not read alike. Telling someone a feature is empty when they
	// have simply filtered it too narrowly sends them looking for a bug.
	let {
		variant = 'empty',
		title,
		description,
		action
	}: {
		/** `empty` — nothing exists yet. `no-results` — a search or filter excluded everything. */
		variant?: 'empty' | 'no-results'
		title: string
		description?: string
		/** The way forward: create the first record, or clear the filter. */
		action?: Snippet
	} = $props()

	// Outline icons at 24×24, matching the inline-SVG convention used across the app nav.
	const iconPath = $derived(
		variant === 'no-results'
			? 'M21 21l-5.2-5.2M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z'
			: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12'
	)
</script>

<div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
	<span
		class="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
	>
		<svg
			class="h-5 w-5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={iconPath} />
		</svg>
	</span>
	<div class="space-y-1">
		<p class="text-sm font-medium text-foreground">{title}</p>
		{#if description}
			<p class="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if action}
		<div class="pt-1">{@render action()}</div>
	{/if}
</div>
