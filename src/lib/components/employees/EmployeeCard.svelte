<script lang="ts">
	interface Employee {
		id: string
		firstName: string
		lastName: string
		employeeNumber: string
		jobTitle: string
		department: { name: string }
		employmentStatus: string
		user: { email: string }
	}

	let { employee }: { employee: Employee } = $props()

	const initials = $derived(
		`${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`.toUpperCase()
	)

	const statusClass = $derived(() => {
		switch (employee.employmentStatus) {
			case 'ACTIVE':
				return 'bg-green-100 text-green-700'
			case 'OFFBOARDED':
				return 'bg-gray-100 text-gray-600'
			case 'PROBATIONARY':
				return 'bg-yellow-100 text-yellow-700'
			case 'RESIGNED':
				return 'bg-red-100 text-red-700'
			default:
				return 'bg-gray-100 text-gray-600'
		}
	})
</script>

<a
	href="/employees/{employee.id}"
	class="block rounded-md border p-4 hover:bg-accent transition-colors"
>
	<div class="flex items-start gap-3">
		<!-- Avatar placeholder -->
		<div
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold"
		>
			{initials}
		</div>

		<div class="min-w-0 flex-1">
			<!-- Name and employee number -->
			<div class="flex items-center gap-2 flex-wrap">
				<span class="font-bold text-sm">{employee.firstName} {employee.lastName}</span>
				<span class="text-xs text-muted-foreground">{employee.employeeNumber}</span>
			</div>

			<!-- Job title and department -->
			<div class="text-sm text-muted-foreground mt-0.5">
				{employee.jobTitle}
				{#if employee.department?.name}
					&middot; {employee.department.name}
				{/if}
			</div>

			<!-- Email -->
			<div class="text-xs text-muted-foreground mt-0.5">{employee.user.email}</div>
		</div>

		<!-- Status badge -->
		<span class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {statusClass()}">
			{employee.employmentStatus}
		</span>
	</div>
</a>
