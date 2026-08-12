<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { ASSIGNABLE_ROLES } from '$lib/rbac'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// CEO manages roles; Super Admin manages account status. The page opens for either,
	// so each control is shown only to the capability that owns it (#132).
	const canManageRoles = $derived(data.canManageRoles)
	const canManageActive = $derived(data.canManageActive)

	// #108: every user row has its own `?/setActive` and `?/setRole` form, so each gets its own
	// guard — a shared one would disable the whole table while one row is in flight. One map per
	// action so toggling a user's status doesn't lock their role dropdown. Plain objects, not
	// `$state`: each guard holds its own reactive `busy`, the maps only memoise identity.
	const setActiveGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const setActiveGuard = (id: string) => (setActiveGuards[id] ??= createSubmitGuard())
	const setRoleGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	// #283: on a REJECTED save, reset the form. A <select multiple>'s `selected` attribute is only
	// its DEFAULT state — once the user has clicked, the live selection is a DOM property that
	// re-rendering the attribute does not touch. So after "you must keep at least one role" the
	// picker keeps showing the user's empty selection, and a browser refresh restores form state
	// too, which makes it look as though the save wiped their roles. It didn't; only the display
	// lied. formElement.reset() restores every control to its `selected` attribute — the server's
	// truth — which is exactly the right meaning of "that save did not happen".
	const setRoleGuard = (id: string) =>
		(setRoleGuards[id] ??= createSubmitGuard(() => async ({ update, result, formElement }) => {
			await update()
			if (result.type === 'failure') formElement.reset()
		}))
</script>

<svelte:head>
	<title>Roles & Permissions — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<BackButton fallback="/settings" label="Settings" preferFallback />

	<div>
		<h1 class="text-2xl font-bold tracking-tight">Roles &amp; Permissions</h1>
		<p class="text-sm text-muted-foreground">
			Manage each user's access level and account status. You cannot change your own role or
			deactivate yourself, and the last active super admin and CEO are protected. Assigning a role
			replaces the user's full role set.
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
					{@const setActive = setActiveGuard(u.id)}
					{@const setRole = setRoleGuard(u.id)}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3 font-medium">{u.email}</td>
						<td class="px-4 py-3 text-muted-foreground">{u.employeeName ?? '—'}</td>
						<td class="px-4 py-3">
							<div class="flex items-center gap-2">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {u.isActive
										? 'bg-green-500/15 text-green-400'
										: 'bg-gray-500/15 text-gray-400'}"
								>
									{u.isActive ? 'ACTIVE' : 'INACTIVE'}
								</span>
								{#if canManageActive}
									<form method="POST" action="?/setActive" use:enhance={setActive.enhance}>
										<input type="hidden" name="userId" value={u.id} />
										<input type="hidden" name="isActive" value={u.isActive ? 'false' : 'true'} />
										<button
											type="submit"
											disabled={setActive.busy}
											class="rounded-md border px-2 py-0.5 text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
										>
											{setActive.busy ? 'Saving…' : u.isActive ? 'Deactivate' : 'Activate'}
										</button>
									</form>
								{/if}
							</div>
						</td>
						<td class="px-4 py-3" colspan="2">
							<!-- #248: gate on the rule the service actually enforces (no self-role-change),
							     not on the target being a CEO. The old CEO block was UI-only — the v1 PATCH
							     twin never had it — and it made CEO a role that could be granted but never
							     revoked. A CEO row is now editable; setUserRoles refuses to remove the last
							     active one (409). -->
							{#if canManageRoles && u.id !== data.user.id}
								<form
									method="POST"
									action="?/setRole"
									use:enhance={setRole.enhance}
									class="flex items-center gap-2"
								>
									<input type="hidden" name="userId" value={u.id} />
									<!-- #283: the picker assigns the whole set. No $state and no bind:value — the
									     selection lives in the DOM, posts natively as a repeated `roles` key, and
									     use:enhance forwards the same FormData. A bound value would be a second
									     source of truth for something the platform already tracks, and Svelte 5
									     warns when a bound <select>'s options also carry `selected`. Prefilling
									     via the native `selected` attribute is the whole of AC-3. -->
									<select
										name="roles"
										multiple
										size={4}
										aria-label="Roles for {u.email}"
										class="flex h-auto w-40 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{#each ASSIGNABLE_ROLES as r (r)}
											<option value={r} selected={u.roles.includes(r)}>{r.replace('_', ' ')}</option
											>
										{/each}
									</select>
									<button
										type="submit"
										disabled={setRole.busy}
										class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
									>
										{setRole.busy ? 'Saving…' : 'Save'}
									</button>
								</form>
							{:else}
								<span class="text-sm text-muted-foreground"
									>{u.roles.map((r) => r.replace('_', ' ')).join(', ')}</span
								>
							{/if}
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
