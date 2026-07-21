<script lang="ts">
	import { page } from '$app/stores'
	import CalculatorWindow from '$lib/components/payroll/CalculatorWindow.svelte'
	import type { LayoutData } from './$types'
	import type { Snippet } from 'svelte'

	let { data, children }: { data: LayoutData; children: Snippet } = $props()

	// Floating calculator (#72), scoped to payroll pages. The layout survives
	// navigation between payroll pages, so an open window (and its inputs/result)
	// follows you from a run to periods and back.
	let calcOpen = $state(false)
	const onCalculatorPage = $derived($page.url.pathname.startsWith('/payroll/calculator'))
</script>

{@render children()}

{#if !onCalculatorPage}
	{#if calcOpen}
		<CalculatorWindow
			employees={data.employees}
			recurringDefaults={data.recurringDefaults}
			onclose={() => (calcOpen = false)}
		/>
	{:else}
		<button
			type="button"
			onclick={() => (calcOpen = true)}
			title="Open payroll calculator"
			class="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm2.25-4.5h.008v.008H10.5v-.008zm0 2.25h.008v.008H10.5V13.5zm0 2.25h.008v.008H10.5v-.008zm2.25-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM6 7.5h12M6 7.5v-3A1.5 1.5 0 017.5 3h9A1.5 1.5 0 0118 4.5v3M6 7.5v12A1.5 1.5 0 007.5 21h9a1.5 1.5 0 001.5-1.5v-12"
				/>
			</svg>
			Calculator
		</button>
	{/if}
{/if}
