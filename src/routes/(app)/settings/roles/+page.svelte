<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const roles = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'] as const
</script>

<svelte:head>
	<title>Roles & Permissions — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
		<p class="text-sm text-muted-foreground">
			Manage each user's access level. You cannot change your own role.
		</p>
	</div>

	<div class="rounded-lg border">
		<table class="w-full text-sm">
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
							<span
								class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {u.isActive
									? 'bg-green-100 text-green-700'
									: 'bg-gray-100 text-gray-600'}"
							>
								{u.isActive ? 'ACTIVE' : 'INACTIVE'}
							</span>
						</td>
						<td class="px-4 py-3" colspan="2">
							<form
								method="POST"
								action="?/setRole"
								use:enhance
								class="flex items-center gap-2"
							>
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
