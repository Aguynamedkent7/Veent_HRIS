<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const roles = [
		'EMPLOYEE',
		'MANAGER',
		'HR_ADMIN',
		'SUPER_ADMIN',
		'PAYROLL_OFFICER',
		'FINANCE'
	] as const
</script>

<svelte:head>
	<title>Roles & Permissions — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<BackButton fallback="/settings" label="Settings" />

	<div>
		<h1 class="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
		<p class="text-sm text-muted-foreground">
			Manage each user's access level and account status. You cannot change your own role or
			deactivate yourself, and the last active super admin is protected.
		</p>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full min-w-max text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.users as u (u.id)}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3 font-medium">{u.email}</td>
						<td class="px-4 py-3 text-muted-foreground">{u.employeeName ?? '—'}</td>
						<td class="px-4 py-3">
							<div class="flex items-center gap-2">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {u.isActive
										? 'bg-green-100 text-green-700'
										: 'bg-gray-100 text-gray-600'}"
								>
									{u.isActive ? 'ACTIVE' : 'INACTIVE'}
								</span>
								<form method="POST" action="?/setActive" use:enhance>
									<input type="hidden" name="userId" value={u.id} />
									<input type="hidden" name="isActive" value={u.isActive ? 'false' : 'true'} />
									<button
										type="submit"
										class="rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
									>
										{u.isActive ? 'Deactivate' : 'Activate'}
									</button>
								</form>
							</div>
						</td>
						<td class="px-4 py-3" colspan="2">
							<form method="POST" action="?/setRole" use:enhance class="flex items-center gap-2">
								<input type="hidden" name="userId" value={u.id} />
								<select
									name="role"
									value={u.role}
									class="flex h-9 w-40 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{#each roles as r (r)}
										<option value={r}>{r.replace('_', ' ')}</option>
									{/each}
								</select>
								<button
									type="submit"
									class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
								>
									Save
								</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-muted-foreground">No users found</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
