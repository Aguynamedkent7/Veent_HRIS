<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'

	// Reusable dashboard feed item (#167): renders both HR-posted announcements and the
	// auto-generated birthday greeting through one layout, differing only by a leading
	// accent icon. `variant` picks the icon/colour; pass a `timestamp` for dated posts.
	let {
		title,
		body,
		timestamp,
		variant = 'default'
	}: {
		title: string
		body?: string
		timestamp?: Date | string
		variant?: 'default' | 'birthday'
	} = $props()

	// Megaphone for posts, a birthday cake for greetings — inline SVG, not glyphs.
	const iconPath = $derived(
		variant === 'birthday'
			? 'M12 8c1.1 0 2-.9 2-2 0-.38-.1-.73-.29-1.03L12 2l-1.71 2.97c-.19.3-.29.65-.29 1.03 0 1.1.9 2 2 2zM5 10.5A1.5 1.5 0 016.5 9h11A1.5 1.5 0 0119 10.5v3.09c-.62.28-1.06.66-1.4.95-.42.36-.6.5-1.1.5s-.68-.14-1.1-.5c-.5-.43-1.2-1.04-2.4-1.04s-1.9.61-2.4 1.04c-.42.36-.6.5-1.1.5s-.68-.14-1.1-.5c-.34-.29-.78-.67-1.4-.95V10.5zM5 16.2c.5 0 .68.14 1.1.5.5.43 1.2 1.04 2.4 1.04s1.9-.61 2.4-1.04c.42-.36.6-.5 1.1-.5s.68.14 1.1.5c.5.43 1.2 1.04 2.4 1.04s1.9-.61 2.4-1.04c.42-.36.6-.5 1.1-.5v4.3A1.5 1.5 0 0117.5 22h-11A1.5 1.5 0 015 20.5v-4.3z'
			: 'M10.34 3.94a2 2 0 013.32 0l.6.9a2 2 0 001.32.86l1.06.18a2 2 0 011.66 2.3l-.18 1.06a2 2 0 00.5 1.55l.72.8a2 2 0 010 2.62l-.72.8a2 2 0 00-.5 1.55l.18 1.06a2 2 0 01-1.66 2.3l-1.06.18a2 2 0 00-1.32.86l-.6.9a2 2 0 01-3.32 0l-.6-.9a2 2 0 00-1.32-.86l-1.06-.18a2 2 0 01-1.66-2.3l.18-1.06a2 2 0 00-.5-1.55l-.72-.8a2 2 0 010-2.62l.72-.8a2 2 0 00.5-1.55l-.18-1.06a2 2 0 011.66-2.3l1.06-.18a2 2 0 001.32-.86l.6-.9z'
	)
</script>

<li class="flex gap-3 py-2.5">
	<span
		class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full {variant ===
		'birthday'
			? 'bg-pink-500/15 text-pink-400'
			: 'bg-primary/10 text-primary'}"
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
	</div>
</li>
