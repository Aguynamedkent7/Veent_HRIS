<script lang="ts">
	import { page } from '$app/stores'
	import type { LayoutData } from './$types'

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props()

	const role = data.user.role
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(role)
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(role)
	const isSuperAdmin = role === 'SUPER_ADMIN'

	const navItems = $derived([
		{ href: '/dashboard', label: 'Dashboard', show: true },
		{ href: '/timesheets', label: 'Timesheets', show: true },
		{ href: '/leave', label: 'Leave', show: true },
		{ href: '/payslips', label: 'Payslips', show: true },
		{ href: '/profile', label: 'Profile', show: true },
		{ href: '/approvals', label: 'Approvals', show: isManager },
		{ href: '/team', label: 'Team', show: isManager },
		{ href: '/employees', label: 'Employees', show: isAdmin },
		{ href: '/departments', label: 'Departments', show: isAdmin },
		{ href: '/payroll', label: 'Payroll', show: isAdmin },
		{ href: '/recruitment', label: 'Recruitment', show: isAdmin },
		{ href: '/reports', label: 'Reports', show: isAdmin },
		{ href: '/settings/holidays', label: 'Holidays', show: isSuperAdmin },
	].filter(i => i.show))

	const roleLabel: Record<string, string> = {
		EMPLOYEE: 'Employee',
		MANAGER: 'Manager',
		HR_ADMIN: 'HR Admin',
		SUPER_ADMIN: 'Super Admin'
	}
</script>

<div class="flex min-h-screen flex-col bg-background">
	<!-- Top nav -->
	<header class="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
		<div class="container mx-auto flex h-14 max-w-screen-xl items-center gap-4">
			<!-- Logo -->
			<a href="/dashboard" class="flex shrink-0 items-center gap-1.5 mr-2">
				<span class="rounded bg-primary px-2 py-0.5 text-sm font-bold tracking-tight text-white">
					VEENT
				</span>
				<span class="text-sm font-semibold tracking-wider text-foreground">HRIS</span>
			</a>

			<!-- Nav links -->
			<nav class="flex flex-1 h-full items-stretch justify-between overflow-x-auto scrollbar-none">
				{#each navItems as item (item.href)}
					{@const active = $page.url.pathname.startsWith(item.href) && (item.href !== '/dashboard' || $page.url.pathname === '/dashboard')}
					<a
						href={item.href}
						class="flex shrink-0 items-center border-b-2 px-3 text-xs font-medium transition-colors
							{active
								? 'border-primary text-primary'
								: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
					>
						{item.label}
					</a>
				{/each}
			</nav>

			<!-- User info -->
			<div class="flex shrink-0 items-center gap-3">
				<div class="hidden flex-col items-end sm:flex">
					<span class="text-xs font-medium text-foreground">{data.user.email}</span>
					<span class="text-[10px] text-muted-foreground">{roleLabel[role] ?? role}</span>
				</div>
				<form method="POST" action="/logout">
					<button
						type="submit"
						class="rounded px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border hover:border-primary/40 hover:text-primary transition-colors"
					>
						Sign out
					</button>
				</form>
			</div>
		</div>
	</header>

	<!-- Page content -->
	<main class="container mx-auto flex-1 py-8 max-w-screen-xl">
		{@render children()}
	</main>
</div>
