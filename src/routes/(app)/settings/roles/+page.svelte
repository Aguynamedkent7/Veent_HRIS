<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { ASSIGNABLE_ROLES, ROLE_LABELS } from '$lib/rbac'
	import Check from 'lucide-svelte/icons/check'
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
	// #283: on a REJECTED save, reset the form back to the server's truth. A checkbox's `checked`
	// attribute is only its DEFAULT state — once the user has clicked, the live value is a DOM
	// property that re-rendering the attribute does not touch. So after "you must keep at least one
	// role" the pills would keep showing the user's empty selection, which reads as though the save
	// wiped their roles. It didn't; only the display lied. formElement.reset() restores every
	// control to its `checked` attribute, which is exactly what "that save did not happen" means.
	const setRoleGuard = (id: string) =>
		(setRoleGuards[id] ??= createSubmitGuard(() => async ({ update, result, formElement }) => {
			await update()
			// Either way the row goes back to following the server: on success `data` already holds
			// the saved set, and on failure nothing was written, so the reset control state is right.
			if (result.type === 'failure') formElement.reset()
			delete draft[id]
		}))

	// #283: the picker's live selection, per user row.
	//
	// The control this replaces was a native <select multiple>, and the reason it had to go is one
	// gesture: a PLAIN click on a multi-select REPLACES the whole selection. On a user holding
	// [VERIFIER, APPROVER], clicking "CEO" silently dropped both — the likeliest gesture was the
	// destructive one, no warning, and the service cannot catch it because one role is a legal set.
	// Ctrl-click is the only safe interaction and nothing on screen taught it.
	//
	// Checkboxes have no modifier-key mode, so every click means exactly what it looks like. They
	// are still plain platform controls posting a repeated `roles` key — the server contract and
	// the AC-3 prefill are unchanged, and no picker library arrives.
	//
	// `draft` mirrors the checkboxes only to drive the summary line and the Save button's enabled
	// state; the inputs remain the source of truth for what is posted, so a failed save resetting
	// the form is still authoritative.
	//
	// It holds an entry ONLY for rows the user has touched — seeding it from data.users would
	// snapshot the initial load, and any row that arrived afterwards would read as having no roles
	// at all. Clearing a row's entry is how "follow the server again" is expressed.
	let draft = $state<Record<string, string[]>>({})
	type Row = { id: string; roles: string[] }
	const rolesOf = (u: Row) => draft[u.id] ?? u.roles
	const toggle = (u: Row, role: string) => {
		const now = rolesOf(u)
		draft[u.id] = now.includes(role) ? now.filter((r) => r !== role) : [...now, role]
	}
	// Order-independent set equality — the same comparison the server makes.
	const isDirty = (u: Row) => {
		const now = rolesOf(u)
		return now.length !== u.roles.length || now.some((r) => !u.roles.includes(r))
	}
	const label = (r: string) => ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r
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
									class="flex w-[17rem] items-start gap-3 sm:w-[26rem]"
								>
									<input type="hidden" name="userId" value={u.id} />
									<fieldset class="min-w-0 flex-1">
										<legend class="sr-only">Roles for {u.email}</legend>
										<div class="flex flex-wrap gap-1.5">
											{#each ASSIGNABLE_ROLES as r (r)}
												{@const on = rolesOf(u).includes(r)}
												<label
													class="inline-flex min-h-11 cursor-pointer select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 {on
														? 'border-primary/40 bg-primary/10 text-primary'
														: 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'} focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background"
												>
													<input
														type="checkbox"
														name="roles"
														value={r}
														checked={u.roles.includes(r)}
														onchange={() => toggle(u, r)}
														class="sr-only"
													/>
													{#if on}
														<Check class="h-3 w-3 shrink-0" aria-hidden="true" />
													{/if}
													{label(r)}
												</label>
											{/each}
										</div>
										<p
											class="mt-1.5 text-xs {rolesOf(u).length === 0
												? 'text-destructive'
												: 'text-muted-foreground'}"
										>
											{#if rolesOf(u).length === 0}
												Pick at least one role.
											{:else}
												{rolesOf(u).length}
												{rolesOf(u).length === 1 ? 'role' : 'roles'}{isDirty(u) ? ' · unsaved' : ''}
											{/if}
										</p>
									</fieldset>
									<button
										type="submit"
										disabled={setRole.busy || !isDirty(u) || rolesOf(u).length === 0}
										class="shrink-0 self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
									>
										{setRole.busy ? 'Saving…' : 'Save'}
									</button>
								</form>
							{:else}
								<!-- Read-only mirror. Same shape as the editable branch so a row does not appear
								     to hold different roles depending on who is looking at it. -->
								<div class="flex w-[17rem] flex-wrap gap-1.5 sm:w-[26rem]">
									{#each u.roles as r (r)}
										<span
											class="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
											>{label(r)}</span
										>
									{/each}
								</div>
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
