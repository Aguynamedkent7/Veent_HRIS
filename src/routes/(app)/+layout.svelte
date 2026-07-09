<script lang="ts">
	import { page } from '$app/stores'
	import type { LayoutData } from './$types'

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props()

	const navItems = [
		{ href: '/dashboard', label: 'Dashboard' },
		{ href: '/employees', label: 'Employees' },
		{ href: '/timesheets', label: 'Timesheets' },
		{ href: '/leave', label: 'Leave' },
		{ href: '/payroll', label: 'Payroll' },
		{ href: '/recruitment', label: 'Recruitment' },
		{ href: '/reports', label: 'Reports' }
	]
</script>

<div class="flex min-h-screen flex-col">
	<header class="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
		<div class="container flex h-14 items-center gap-6">
			<span class="font-semibold">Veent HRIS</span>
			<nav class="flex items-center gap-1">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground {$page.url.pathname.startsWith(item.href)
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>
			<div class="ml-auto flex items-center gap-2">
				<span class="text-xs text-muted-foreground">{data.user.email}</span>
				<form method="POST" action="/logout">
					<button
						type="submit"
						class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					>
						Sign out
					</button>
				</form>
			</div>
		</div>
	</header>

	<main class="container flex-1 py-6">
		{@render children()}
	</main>
</div>
