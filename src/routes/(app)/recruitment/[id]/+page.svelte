<script lang="ts">
	import { enhance } from '$app/forms'
	import ApplicantKanban from '$lib/components/recruitment/ApplicantKanban.svelte'
	import { formatShortDate } from '$lib/utils/format'
	import { can } from '$lib/rbac'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const { posting, applicants, userRole } = $derived(data)

	// Mirror the server guard (MANAGE_HR) so promoted Managers (#133) see the HR controls
	// they're actually allowed to use, not just HR_ADMIN/SUPER_ADMIN.
	const isHrAdmin = $derived(can(userRole, 'MANAGE_HR'))

	const hiredApplicants = $derived(
		applicants.filter((a: { currentStage: string }) => a.currentStage === 'HIRED')
	)

	function statusBadgeClass(status: string) {
		if (status === 'OPEN') return 'bg-green-100 text-green-700'
		if (status === 'CLOSED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}
</script>

<svelte:head>
	<title>{posting.title} — Recruitment — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<!-- Posting Header -->
	<div class="rounded-lg border p-6 space-y-4">
		<div class="flex items-start justify-between gap-4">
			<div class="space-y-1">
				<div class="flex items-center gap-3">
					<h1 class="text-2xl font-bold tracking-tight">{posting.title}</h1>
					<span
						class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusBadgeClass(
							posting.status
						)}"
					>
						{posting.status}
					</span>
				</div>
				<div class="flex flex-wrap gap-4 text-sm text-muted-foreground">
					{#if posting.department}
						<span>{posting.department.name}</span>
					{/if}
					{#if posting.postedAt}
						<span>Posted {formatShortDate(posting.postedAt)}</span>
					{/if}
				</div>
			</div>

			<div class="flex shrink-0 gap-2">
				{#if posting.status === 'OPEN'}
					<a
						href="/recruitment/{posting.id}/apply"
						class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
					>
						Add Applicant
					</a>
				{/if}
				{#if isHrAdmin}
					{#if posting.status === 'OPEN'}
						<form method="POST" action="?/updateStatus" use:enhance>
							<input type="hidden" name="status" value="CLOSED" />
							<button
								type="submit"
								class="rounded-md border px-4 py-2 text-sm font-medium text-destructive border-destructive/30 hover:bg-destructive/10"
							>
								Close Posting
							</button>
						</form>
					{:else if posting.status === 'DRAFT'}
						<form method="POST" action="?/updateStatus" use:enhance>
							<input type="hidden" name="status" value="OPEN" />
							<button
								type="submit"
								class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>
								Publish
							</button>
						</form>
					{:else if posting.status === 'CLOSED'}
						<form method="POST" action="?/updateStatus" use:enhance>
							<input type="hidden" name="status" value="OPEN" />
							<button
								type="submit"
								class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
							>
								Reopen
							</button>
						</form>
					{/if}
					<a href="/recruitment" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">
						Back
					</a>
				{/if}
			</div>
		</div>

		{#if posting.description}
			<div class="prose prose-sm max-w-none border-t pt-4">
				<p class="text-sm text-muted-foreground whitespace-pre-wrap">{posting.description}</p>
			</div>
		{/if}
	</div>

	<!-- Hired Applicants — Convert to Employee -->
	{#if isHrAdmin && hiredApplicants.length > 0}
		<div class="rounded-lg border p-4 space-y-3">
			<h2 class="text-sm font-semibold">Hired Applicants — Convert to Employee</h2>
			<div class="space-y-2">
				{#each hiredApplicants as applicant (applicant.id)}
					<div class="flex items-center justify-between rounded-md border px-4 py-2">
						<div>
							<p class="text-sm font-medium">{applicant.firstName} {applicant.lastName}</p>
							<p class="text-xs text-muted-foreground">{applicant.email}</p>
						</div>
						{#if !applicant.convertedToEmployeeId}
							<form method="POST" action="?/convert" use:enhance>
								<input type="hidden" name="applicantId" value={applicant.id} />
								<button
									type="submit"
									class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
								>
									Convert to Employee
								</button>
							</form>
						{:else}
							<span class="text-xs text-green-600 font-medium">Already converted</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Applicant Kanban -->
	<div class="space-y-2">
		<h2 class="text-lg font-semibold">Applicants ({applicants.length})</h2>
		<ApplicantKanban {applicants} readonly={!isHrAdmin} />
	</div>
</div>
