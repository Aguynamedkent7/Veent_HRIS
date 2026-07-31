<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'

	// Reusable dashboard feed item (#167/#180): renders HR-posted announcements, the
	// birthday greeting, and award announcements through one layout, differing only by a
	// leading accent icon. `variant` picks the icon/colour; pass a `timestamp` for dated posts.
	let {
		title,
		body,
		timestamp,
		author = null,
		variant = 'default'
	}: {
		title: string
		body?: string
		timestamp?: Date | string
		/** Byline for HR-posted announcements (#141). Null for birthdays and awards, which
		 *  are generated rather than written by anyone. */
		author?: string | null
		variant?: 'default' | 'birthday' | 'award'
	} = $props()

	// Megaphone for posts, a birthday cake for greetings, a trophy for awards — inline SVG.
	const iconPath = $derived(
		variant === 'birthday'
			? 'M12 8c1.1 0 2-.9 2-2 0-.38-.1-.73-.29-1.03L12 2l-1.71 2.97c-.19.3-.29.65-.29 1.03 0 1.1.9 2 2 2zM5 10.5A1.5 1.5 0 016.5 9h11A1.5 1.5 0 0119 10.5v3.09c-.62.28-1.06.66-1.4.95-.42.36-.6.5-1.1.5s-.68-.14-1.1-.5c-.5-.43-1.2-1.04-2.4-1.04s-1.9.61-2.4 1.04c-.42.36-.6.5-1.1.5s-.68-.14-1.1-.5c-.34-.29-.78-.67-1.4-.95V10.5zM5 16.2c.5 0 .68.14 1.1.5.5.43 1.2 1.04 2.4 1.04s1.9-.61 2.4-1.04c.42-.36.6-.5 1.1-.5s.68.14 1.1.5c.5.43 1.2 1.04 2.4 1.04s1.9-.61 2.4-1.04c.42-.36.6-.5 1.1-.5v4.3A1.5 1.5 0 0117.5 22h-11A1.5 1.5 0 015 20.5v-4.3z'
			: variant === 'award'
				? 'M12 2l2.9 6.26 6.9.6-5.2 4.56 1.55 6.74L12 17.27 5.85 20.72 7.4 13.98 2.2 9.42l6.9-.6L12 2z'
				: 'M10.34 3.94a2 2 0 013.32 0l.6.9a2 2 0 001.32.86l1.06.18a2 2 0 011.66 2.3l-.18 1.06a2 2 0 00.5 1.55l.72.8a2 2 0 010 2.62l-.72.8a2 2 0 00-.5 1.55l.18 1.06a2 2 0 01-1.66 2.3l-1.06.18a2 2 0 00-1.32.86l-.6.9a2 2 0 01-3.32 0l-.6-.9a2 2 0 00-1.32-.86l-1.06-.18a2 2 0 01-1.66-2.3l.18-1.06a2 2 0 00-.5-1.55l-.72-.8a2 2 0 010-2.62l.72-.8a2 2 0 00.5-1.55l-.18-1.06a2 2 0 011.66-2.3l1.06-.18a2 2 0 001.32-.86l.6-.9z'
	)

	const iconWrapClass = $derived(
		variant === 'birthday'
			? 'bg-pink-500/15 text-pink-400'
			: variant === 'award'
				? 'bg-amber-500/15 text-amber-500'
				: 'bg-primary/10 text-primary'
	)
</script>

<li class="flex gap-3 py-2.5">
	<span
		class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full {iconWrapClass}"
	>
		<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d={iconPath} />
		</svg>
	</span>
	<div class="min-w-0 flex-1">
		<div class="flex items-baseline justify-between gap-3">
			<p class="text-sm font-medium text-foreground">{title}</p>
			{#if timestamp}
				<span class="shrink-0 text-xs text-muted-foreground">{formatShortDate(timestamp)}</span>
			{/if}
		</div>
		{#if body}
			<p class="mt-0.5 whitespace-pre-line text-sm text-muted-foreground">{body}</p>
		{/if}
		<!-- Omitted rather than rendered blank: authorId is optional, so a seeded or imported
		     announcement can genuinely have no author (#141). -->
		{#if author}
			<p class="mt-1 text-xs text-muted-foreground">— {author}</p>
		{/if}
	</div>
</li>
