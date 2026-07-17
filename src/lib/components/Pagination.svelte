<script lang="ts">
	import { page as pageStore } from '$app/stores'

	// Structural twin of $lib/server/pagination's Pagination (server modules
	// can't be imported into client components).
	interface Meta {
		page: number
		pageSize: number
		total: number
		totalPages: number
		start: number
		end: number
		param: string
		label: string
	}

	let { meta }: { meta: Meta } = $props()

	// Links mutate only this table's param on the CURRENT url, so active filters
	// (status, search, another table's page) survive page changes.
	function href(to: number): string {
		const params = new URLSearchParams($pageStore.url.searchParams)
		params.set(meta.param, String(to))
		return `?${params.toString()}`
	}
</script>

{#if meta.total > meta.pageSize}
	<nav class="flex items-center justify-between gap-3" aria-label="Pagination">
		<p class="text-sm text-muted-foreground">{meta.label}</p>
		<div class="flex items-center gap-2">
			{#if meta.page > 1}
				<a
					href={href(meta.page - 1)}
					class="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
				>
					← Previous
				</a>
			{:else}
				<span class="rounded-md border px-3 py-1.5 text-sm text-muted-foreground/50">
					← Previous
				</span>
			{/if}
			<span class="text-sm text-muted-foreground">
				Page {meta.page} of {meta.totalPages}
			</span>
			{#if meta.page < meta.totalPages}
				<a
					href={href(meta.page + 1)}
					class="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
				>
					Next →
				</a>
			{:else}
				<span class="rounded-md border px-3 py-1.5 text-sm text-muted-foreground/50">Next →</span>
			{/if}
		</div>
	</nav>
{/if}
