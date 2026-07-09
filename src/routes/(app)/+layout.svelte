<script lang="ts">
	import { page } from '$app/stores'
	import type { LayoutData } from './$types'

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props()

	const role = data.user.role

	const isEmployee = true // all authenticated users
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(role)
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(role)
	const isSuperAdmin = role === 'SUPER_ADMIN'

	const navItems = $derived([
		{ href: '/dashboard', label: 'Dashboard', show: isEmployee },
		{ href: '/timesheets', label: 'Timesheets', show: isEmployee },
		{ href: '/leave', label: 'Leave', show: isEmployee },
		{ href: '/payslips', label: 'Payslips', show: isEmployee },
		{ href: '/profile', label: 'Profile', show: isEmployee },
		{ href: '/approvals', label: 'Approvals', show: isManager },
		{ href: '/team', label: 'Team', show: isManager },
		{ href: '/employees', label: 'Employees', show: isAdmin },
		{ href: '/departments', label: 'Departments', show: isAdmin },
		{ href: '/payroll', label: 'Payroll', show: isAdmin },
		{ href: '/recruitment', label: 'Recruitment', show: isAdmin },
		{ href: '/reports', label: 'Reports', show: isAdmin },
		{ href: '/settings/holidays', label: 'Holidays', show: isSuperAdmin },
	].filter(i => i.show))
</script>

<div class="flex min-h-screen flex-col">
	<header class="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
		<div class="container flex h-14 items-center gap-4">
			<span class="font-semibold shrink-0">Veent HRIS</span>
			<nav class="flex items-center gap-0.5 overflow-x-auto">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground {$page.url.pathname.startsWith(item.href)
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>
			<div class="ml-auto flex shrink-0 items-center gap-2">
				<span class="text-xs text-muted-foreground hidden sm:block">{data.user.email}</span>
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
