<script lang="ts">
	import { enhance } from '$app/forms'

	interface Applicant {
		id: string
		firstName: string
		lastName: string
		email: string
		currentStage: string
		createdAt: Date
	}

	let {
		applicants,
		readonly = false
	}: {
		applicants: Applicant[]
		readonly?: boolean
	} = $props()

	const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'] as const
	type Stage = (typeof STAGES)[number]

	const STAGE_LABELS: Record<Stage, string> = {
		APPLIED: 'Applied',
		SCREENING: 'Screening',
		INTERVIEW: 'Interview',
		OFFER: 'Offer',
		HIRED: 'Hired',
		REJECTED: 'Rejected'
	}

	// Left-border accent per stage — keeps cards on the theme surface (bg-card) so
	// they stay readable in dark mode instead of a hardcoded white background.
	const STAGE_COLORS: Record<Stage, string> = {
		APPLIED: 'border-l-blue-400',
		SCREENING: 'border-l-yellow-400',
		INTERVIEW: 'border-l-purple-400',
		OFFER: 'border-l-orange-400',
		HIRED: 'border-l-green-400',
		REJECTED: 'border-l-red-400'
	}

	const STAGE_HEADER_COLORS: Record<Stage, string> = {
		APPLIED: 'bg-blue-100 text-blue-800',
		SCREENING: 'bg-yellow-100 text-yellow-800',
		INTERVIEW: 'bg-purple-100 text-purple-800',
		OFFER: 'bg-orange-100 text-orange-800',
		HIRED: 'bg-green-100 text-green-800',
		REJECTED: 'bg-red-100 text-red-800'
	}

	function getNextStage(stage: Stage): Stage | null {
		const idx = STAGES.indexOf(stage)
		// REJECTED has no next; HIRED is terminal (but REJECTED is also reachable from any)
		if (stage === 'HIRED' || stage === 'REJECTED') return null
		return STAGES[idx + 1] ?? null
	}

	function formatDate(date: Date | string) {
		return new Date(date).toLocaleDateString('en-PH', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		})
	}

	function applicantsInStage(stage: Stage) {
		return applicants.filter((a) => a.currentStage === stage)
	}
</script>

<div class="overflow-x-auto pb-4">
	<div class="flex gap-4 min-w-max">
		{#each STAGES as stage}
			{@const stageApplicants = applicantsInStage(stage)}
			<div class="w-64 flex-shrink-0">
				<!-- Column Header -->
				<div
					class="mb-2 flex items-center justify-between rounded-md px-3 py-2 {STAGE_HEADER_COLORS[
						stage
					]}"
				>
					<span class="text-sm font-semibold">{STAGE_LABELS[stage]}</span>
					<span class="rounded-full bg-white/60 px-2 py-0.5 text-xs font-medium">
						{stageApplicants.length}
					</span>
				</div>

				<!-- Cards -->
				<div class="space-y-2">
					{#each stageApplicants as applicant (applicant.id)}
						<div class="rounded-md border border-l-4 p-3 shadow-sm {STAGE_COLORS[stage]} bg-card">
							{#if readonly}
								<p class="text-sm font-medium text-foreground">
									{applicant.firstName}
									{applicant.lastName}
								</p>
							{:else}
								<a
									href="/recruitment/applicant/{applicant.id}"
									class="text-sm font-medium text-primary hover:underline"
								>
									{applicant.firstName}
									{applicant.lastName}
								</a>
							{/if}
							<p class="mt-0.5 truncate text-xs text-muted-foreground">{applicant.email}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								Applied {formatDate(applicant.createdAt)}
							</p>

							{#if !readonly}
								{@const nextStage = getNextStage(stage as Stage)}
								<div class="mt-2 flex flex-wrap gap-1">
									{#if nextStage}
										<form method="POST" action="?/advanceStage" use:enhance>
											<input type="hidden" name="applicantId" value={applicant.id} />
											<input type="hidden" name="stage" value={nextStage} />
											<button
												type="submit"
												class="rounded px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
											>
												Move to {STAGE_LABELS[nextStage]}
											</button>
										</form>
									{/if}
									{#if stage !== 'REJECTED' && stage !== 'HIRED'}
										<form method="POST" action="?/advanceStage" use:enhance>
											<input type="hidden" name="applicantId" value={applicant.id} />
											<input type="hidden" name="stage" value="REJECTED" />
											<button
												type="submit"
												class="rounded px-2 py-0.5 text-xs font-medium border text-destructive border-destructive/30 hover:bg-destructive/10"
											>
												Reject
											</button>
										</form>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<div
							class="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
						>
							No applicants
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
