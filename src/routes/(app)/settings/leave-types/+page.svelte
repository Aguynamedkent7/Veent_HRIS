<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const inputClass =
		'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>Leave Types — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<a href="/settings" class="text-sm text-muted-foreground hover:underline">← Settings</a>
		<h1 class="mt-1 text-2xl font-bold tracking-tight">Leave Types</h1>
		<p class="text-sm text-muted-foreground">
			Master data for the leave/request flow: name, whether it's paid, the default yearly
			allocation, and carry-over policy. Deactivate a type to hide it from new requests without
			affecting existing balances.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<!-- Add -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Add leave type</h2>
		<form method="POST" action="?/add" use:enhance class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<div class="lg:col-span-2">
				<label for="add-name" class="text-xs font-medium text-muted-foreground">Name</label>
				<input id="add-name" name="name" required placeholder="e.g. Vacation Leave" class="mt-1 {inputClass}" />
			</div>
			<div>
				<label for="add-days" class="text-xs font-medium text-muted-foreground">Default days / year</label>
				<input id="add-days" name="defaultDaysPerYear" type="number" min="0" max="365" step="0.5" value="0" class="mt-1 {inputClass}" />
			</div>
			<div>
				<label for="add-carry" class="text-xs font-medium text-muted-foreground">Max carry-over days</label>
				<input id="add-carry" name="maxCarryOverDays" type="number" min="0" max="365" step="0.5" placeholder="0" class="mt-1 {inputClass}" />
			</div>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="isPaid" checked class="align-middle" /> Paid
			</label>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="allowCarryOver" class="align-middle" /> Allow carry-over
			</label>
			<div class="sm:col-span-2 lg:col-span-4">
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Add leave type</button
				>
			</div>
		</form>
	</section>

	<!-- List -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Leave types</h2>
		{#if data.leaveTypes.length === 0}
			<p class="text-sm text-muted-foreground">No leave types yet — add one above.</p>
		{:else}
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full min-w-max text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
							<th class="px-3 py-2 text-center font-medium text-muted-foreground">Paid</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">Days/yr</th>
							<th class="px-3 py-2 text-center font-medium text-muted-foreground">Carry-over</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">Max carry</th>
							<th class="px-3 py-2"></th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.leaveTypes as lt (lt.id)}
							<tr class="hover:bg-muted/30 {lt.isActive ? '' : 'opacity-50'}">
								<td class="px-3 py-2">
									<input form="edit-{lt.id}" name="name" value={lt.name} required class={inputClass} />
								</td>
								<td class="px-3 py-2 text-center">
									<input form="edit-{lt.id}" type="checkbox" name="isPaid" checked={lt.isPaid} class="align-middle" />
								</td>
								<td class="px-3 py-2 text-right">
									<input
										form="edit-{lt.id}"
										name="defaultDaysPerYear"
										type="number"
										min="0"
										max="365"
										step="0.5"
										value={Number(lt.defaultDaysPerYear)}
										class="{inputClass} w-24 text-right"
									/>
								</td>
								<td class="px-3 py-2 text-center">
									<input form="edit-{lt.id}" type="checkbox" name="allowCarryOver" checked={lt.allowCarryOver} class="align-middle" />
								</td>
								<td class="px-3 py-2 text-right">
									<input
										form="edit-{lt.id}"
										name="maxCarryOverDays"
										type="number"
										min="0"
										max="365"
										step="0.5"
										value={lt.maxCarryOverDays == null ? '' : Number(lt.maxCarryOverDays)}
										class="{inputClass} w-24 text-right"
									/>
								</td>
								<td class="px-3 py-2 text-right">
									<form method="POST" action="?/update" id="edit-{lt.id}" use:enhance>
										<input type="hidden" name="id" value={lt.id} />
										<button
											type="submit"
											class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">Save</button
										>
									</form>
								</td>
								<td class="px-3 py-2 text-right">
									<form method="POST" action="?/toggle" use:enhance>
										<input type="hidden" name="id" value={lt.id} />
										<button
											type="submit"
											class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
											>{lt.isActive ? 'Deactivate' : 'Activate'}</button
										>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-xs text-muted-foreground">
				Edit a row's fields and press <span class="font-medium">Save</span>. Carry-over max applies
				only when carry-over is enabled.
			</p>
		{/if}
	</section>
</div>
