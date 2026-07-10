<script lang="ts">
	import Skeleton from './Skeleton.svelte'

	let { rows = 5, cols = 5 }: { rows?: number; cols?: number } = $props()

	const rowList = $derived(Array.from({ length: rows }))
	const colList = $derived(Array.from({ length: cols }))
</script>

<div class="rounded-lg border" aria-hidden="true">
	<div class="flex gap-4 border-b bg-muted/50 px-4 py-3">
		{#each colList as _, i (i)}
			<Skeleton class="h-4 flex-1" />
		{/each}
	</div>
	<div class="divide-y">
		{#each rowList as _, r (r)}
			<div class="flex gap-4 px-4 py-3">
				{#each colList as _, c (c)}
					<Skeleton class="h-4 flex-1" />
				{/each}
			</div>
		{/each}
	</div>
</div>
