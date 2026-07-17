<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head>
	<title>Company Info — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<div>
		<BackButton fallback="/settings" label="Settings" />
		<h1 class="mt-1 text-2xl font-bold tracking-tight">Company Information</h1>
		<p class="text-sm text-muted-foreground">Appears on payslips, reports, and the org header.</p>
	</div>

	{#if form?.success}
		<div class="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
			Company info saved.
		</div>
	{/if}
	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-4 rounded-lg border bg-card p-6">
		<div class="grid gap-1.5">
			<label for="name" class="text-sm font-medium">Company name</label>
			<input
				id="name"
				name="name"
				type="text"
				value={data.company.name}
				required
				class="h-9 rounded-md border border-input bg-background px-3 text-sm"
			/>
		</div>
		<div class="grid gap-1.5">
			<label for="address" class="text-sm font-medium"
				>Address <span class="text-muted-foreground">(optional)</span></label
			>
			<textarea
				id="address"
				name="address"
				rows="2"
				class="rounded-md border border-input bg-background px-3 py-2 text-sm"
				>{data.company.address ?? ''}</textarea
			>
		</div>
		<div class="grid gap-1.5">
			<label for="logoUrl" class="text-sm font-medium"
				>Logo URL <span class="text-muted-foreground">(optional)</span></label
			>
			<input
				id="logoUrl"
				name="logoUrl"
				type="url"
				value={data.company.logoUrl ?? ''}
				placeholder="https://…"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm"
			/>
			{#if data.company.logoUrl}
				<img
					src={data.company.logoUrl}
					alt="Company logo preview"
					class="mt-2 h-12 w-auto rounded border object-contain"
				/>
			{/if}
		</div>
		<button
			type="submit"
			class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>Save</button
		>
	</form>
</div>
