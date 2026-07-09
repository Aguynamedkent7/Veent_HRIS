<script lang="ts">
	import { enhance } from '$app/forms'
	import type { ActionData } from './$types'

	let { form }: { form: ActionData } = $props()
	let loading = $state(false)
</script>

<svelte:head>
	<title>Sign In — Veent HRIS</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-2 text-center">
			<h1 class="text-2xl font-bold tracking-tight">Veent HRIS</h1>
			<p class="text-sm text-muted-foreground">Sign in to your account</p>
		</div>

		<form
			method="POST"
			class="space-y-4"
			use:enhance={() => {
				loading = true
				return async ({ update }) => {
					loading = false
					update()
				}
			}}
		>
			{#if form?.error}
				<div class="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{form.error}
				</div>
			{/if}

			<div class="space-y-2">
				<label for="email" class="text-sm font-medium leading-none">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					placeholder="you@company.com"
				/>
			</div>

			<div class="space-y-2">
				<label for="password" class="text-sm font-medium leading-none">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>

			<button
				type="submit"
				disabled={loading}
				class="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
			>
				{loading ? 'Signing in…' : 'Sign in'}
			</button>
		</form>
	</div>
</div>
