<script lang="ts">
	import { enhance } from '$app/forms'
	import ApplicantKanban from '$lib/components/recruitment/ApplicantKanban.svelte'
	import { formatShortDate } from '$lib/utils/format'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// #108: the three status forms are mutually exclusive branches, so only one is ever
	// mounted — a guard each is enough to stop a double-click re-firing the same transition.
	const closePosting = createSubmitGuard()
	const publishPosting = createSubmitGuard()
	const reopenPosting = createSubmitGuard()

	// #108: each hired applicant row is its own `?/convert` form and a double-click here creates a
	// duplicate employee. A shared guard would disable the whole list while any one row is in
	// flight, so create one lazily per applicant id. Plain object, not `$state` — each guard owns
	// its own reactive `busy`, this map only memoises identity.
	const convertGuards: Record<string, ReturnType<typeof createSubmitGuard>> = {}
	const convertGuard = (id: string) => (convertGuards[id] ??= createSubmitGuard())

	const { posting, applicants, userRole } = $derived(data)

	const isHrAdmin = $derived(userRole === 'HR_ADMIN' || userRole === 'SUPER_ADMIN')

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
						<form method="POST" action="?/updateStatus" use:enhance={closePosting.enhance}>
							<input type="hidden" name="status" value="CLOSED" />
							<button
								type="submit"
								disabled={closePosting.busy}
								class="rounded-md border px-4 py-2 text-sm font-medium text-destructive border-destructive/30 hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
							>
								{closePosting.busy ? 'Closing…' : 'Close Posting'}
							</button>
						</form>
					{:else if posting.status === 'DRAFT'}
						<form method="POST" action="?/updateStatus" use:enhance={publishPosting.enhance}>
							<input type="hidden" name="status" value="OPEN" />
							<button
								type="submit"
								disabled={publishPosting.busy}
								class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
							>
								{publishPosting.busy ? 'Publishing…' : 'Publish'}
							</button>
						</form>
					{:else if posting.status === 'CLOSED'}
						<form method="POST" action="?/updateStatus" use:enhance={reopenPosting.enhance}>
							<input type="hidden" name="status" value="OPEN" />
							<button
								type="submit"
								disabled={reopenPosting.busy}
								class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
							>
								{reopenPosting.busy ? 'Reopening…' : 'Reopen'}
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
							{@const convert = convertGuard(applicant.id)}
							<form method="POST" action="?/convert" use:enhance={convert.enhance}>
								<input type="hidden" name="applicantId" value={applicant.id} />
								<button
									type="submit"
									disabled={convert.busy}
									class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
								>
									{convert.busy ? 'Converting…' : 'Convert to Employee'}
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
