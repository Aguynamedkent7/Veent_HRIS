<script lang="ts">
	import { enhance } from '$app/forms'
	import type { ActionData } from './$types'

	let { form }: { form: ActionData } = $props()
	let loading = $state(false)
</script>

<svelte:head>
	<title>Sign In — Veent HRIS</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-background px-4">
	<!-- Brand -->
	<div class="mb-8 flex flex-col items-center gap-3">
		<img src="/veent-logo.png" alt="Veent HRIS" class="h-14 w-auto" />
		<p class="text-sm text-muted-foreground">Human Resource Information System</p>
	</div>

	<!-- Card -->
	<div class="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
		<div class="mb-5">
			<h1 class="text-base font-semibold">Sign in to your account</h1>
			<p class="mt-1 text-xs text-muted-foreground">Enter your work credentials to continue</p>
		</div>

		{#if form?.error}
			<div class="mb-4 rounded bg-destructive/15 px-3 py-2 text-sm text-red-400">
				{form.error}
			</div>
		{/if}

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
			<div class="space-y-1.5">
				<label for="email" class="text-sm font-medium">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					placeholder="you@company.com"
					class="input"
				/>
			</div>

			<div class="space-y-1.5">
				<label for="password" class="text-sm font-medium">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					placeholder="••••••••"
					class="input"
				/>
			</div>

			<button type="submit" disabled={loading} class="btn-primary w-full h-10 disabled:opacity-60">
				{loading ? 'Signing in…' : 'Sign In'}
			</button>
		</form>
	</div>

	<p class="mt-6 text-xs text-muted-foreground">Veent HRIS · {new Date().getFullYear()}</p>
</div>
