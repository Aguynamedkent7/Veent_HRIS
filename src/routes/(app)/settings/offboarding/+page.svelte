<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import ConfirmButton from '$lib/components/ui/ConfirmButton.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const add = createSubmitGuard()

	// Per-row guards so saving/toggling one item doesn't freeze the whole list.
	const saveGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const saveGuard = (id: string) => (saveGuards[id] ??= createSubmitGuard())
	const toggleGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const toggleGuard = (id: string) => (toggleGuards[id] ??= createSubmitGuard())

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>Offboarding Checklist — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<BackButton fallback="/settings" label="Settings" preferFallback />
		<h1 class="mt-1 text-2xl font-bold tracking-tight">Offboarding Checklist</h1>
		<p class="text-sm text-muted-foreground">
			The clearance steps every separation case starts with. Each names a task and the department
			that signs it off. Opening a separation copies the active steps into the case, and the
			departing employee is emailed a transition notice listing them.
		</p>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400"
		>
			{form.error}
		</div>
	{/if}

	<!-- Add step -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Add a clearance step</h2>
		<form
			method="POST"
			action="?/add"
			use:enhance={add.enhance}
			class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
		>
			<div>
				<label for="add-label" class="text-xs font-medium text-muted-foreground">Task</label>
				<input
					id="add-label"
					name="label"
					required
					maxlength="120"
					placeholder="e.g. Return company equipment"
					class="mt-1 {inputClass}"
				/>
			</div>
			<div>
				<label for="add-department" class="text-xs font-medium text-muted-foreground"
					>Department</label
				>
				<input
					id="add-department"
					name="department"
					required
					maxlength="80"
					placeholder="e.g. IT"
					class="mt-1 {inputClass}"
				/>
			</div>
			<button
				type="submit"
				disabled={add.busy}
				class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>{add.busy ? 'Adding…' : 'Add step'}</button
			>
		</form>
	</section>

	<!-- List -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Clearance steps</h2>
		{#if data.items.length === 0}
			<p class="text-sm text-muted-foreground">No steps yet.</p>
		{:else}
			<ul class="divide-y">
				{#each data.items as item, i (item.id)}
					{@const save = saveGuard(item.id)}
					{@const toggle = toggleGuard(item.id)}
					<li
						data-label={item.label}
						class="flex flex-wrap items-start gap-3 py-3 {item.isActive ? '' : 'opacity-50'}"
					>
						<!-- Reorder -->
						<div class="flex flex-col">
							<form method="POST" action="?/move" use:enhance>
								<input type="hidden" name="id" value={item.id} />
								<input type="hidden" name="direction" value="up" />
								<button
									type="submit"
									disabled={i === 0}
									aria-label="Move up"
									class="rounded border px-1.5 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
									>↑</button
								>
							</form>
							<form method="POST" action="?/move" use:enhance>
								<input type="hidden" name="id" value={item.id} />
								<input type="hidden" name="direction" value="down" />
								<button
									type="submit"
									disabled={i === data.items.length - 1}
									aria-label="Move down"
									class="mt-1 rounded border px-1.5 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
									>↓</button
								>
							</form>
						</div>

						<!-- Task + department (editable) -->
						<div class="grid min-w-[12rem] flex-1 gap-1 sm:grid-cols-[1fr_10rem]">
							<input
								form="edit-{item.id}"
								name="label"
								value={item.label}
								required
								maxlength="120"
								class={inputClass}
							/>
							<input
								form="edit-{item.id}"
								name="department"
								value={item.department}
								required
								maxlength="80"
								placeholder="Department"
								class={inputClass}
							/>
						</div>

						<!-- Actions -->
						<div class="flex flex-wrap items-center gap-2">
							<form method="POST" action="?/update" id="edit-{item.id}" use:enhance={save.enhance}>
								<input type="hidden" name="id" value={item.id} />
								<button
									type="submit"
									disabled={save.busy}
									class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
									>{save.busy ? 'Saving…' : 'Save'}</button
								>
							</form>
							<form method="POST" action="?/toggle" use:enhance={toggle.enhance}>
								<input type="hidden" name="id" value={item.id} />
								<button
									type="submit"
									disabled={toggle.busy}
									class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
									>{toggle.busy ? '…' : item.isActive ? 'Hide' : 'Show'}</button
								>
							</form>
							<ConfirmButton
								action="?/remove"
								title="Delete step?"
								message="This removes the step from the template. Existing separation cases keep their copy."
								triggerLabel="Delete"
								triggerClass="rounded-md border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
							>
								<input type="hidden" name="id" value={item.id} />
							</ConfirmButton>
						</div>
					</li>
				{/each}
			</ul>
			<p class="text-xs text-muted-foreground">
				Hidden steps stay off new separation cases. Editing the template does not change cases
				already opened.
			</p>
		{/if}
	</section>
</div>
