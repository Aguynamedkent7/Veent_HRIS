<script lang="ts">
	import { page } from '$app/stores'

	const title = $derived(
		$page.status === 403
			? 'Access Denied'
			: $page.status === 404
				? 'Page Not Found'
				: 'Server Error'
	)
</script>

<svelte:head>
	<title>{title} — Veent HRIS</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-background px-4">
	<div class="w-full max-w-md space-y-6 text-center">
		<!-- Status Code -->
		<p class="text-8xl font-bold tracking-tight text-muted-foreground/30">{$page.status}</p>

		<!-- Title & Message -->
		{#if $page.status === 403}
			<div class="space-y-2">
				<h1 class="text-2xl font-bold tracking-tight">Access Denied</h1>
				<p class="text-muted-foreground">You don't have permission to view this page.</p>
			</div>
		{:else if $page.status === 404}
			<div class="space-y-2">
				<h1 class="text-2xl font-bold tracking-tight">Page Not Found</h1>
				<p class="text-muted-foreground">The page you're looking for doesn't exist.</p>
			</div>
		{:else}
			<div class="space-y-2">
				<h1 class="text-2xl font-bold tracking-tight">Server Error</h1>
				<p class="text-muted-foreground">Something went wrong. Please try again.</p>
				{#if $page.error?.message}
					<p class="text-sm text-muted-foreground/70 italic">{$page.error.message}</p>
				{/if}
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex items-center justify-center gap-3">
			<a
				href="/dashboard"
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Go to Dashboard
			</a>
			<button
				onclick={() => history.back()}
				class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
			>
				Go Back
			</button>
		</div>
	</div>
</div>
