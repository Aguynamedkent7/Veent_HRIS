<script lang="ts">
	import CalculatorPanel from './CalculatorPanel.svelte'
	import type { CalcEmployee } from './CalculatorPanel.svelte'

	// Floating, draggable, resizable, minimizable calculator window (#72).
	// Lives in the payroll layout so its state (position, entered values, result)
	// survives navigation between payroll pages.

	let {
		employees,
		recurringDefaults,
		onclose
	}: {
		employees: CalcEmployee[]
		recurringDefaults: Record<string, { allowances: number; incentives: number }>
		onclose: () => void
	} = $props()

	const MARGIN = 8
	let x = $state(MARGIN)
	let y = $state(MARGIN)
	let minimized = $state(false)
	let panel = $state<HTMLElement | null>(null)
	let savedHeight = ''

	// Size lives as inline style set once here (not in the reactive style attribute),
	// so the browser's native resize handle can change it without the next drag
	// re-render snapping it back.
	function initWindow(node: HTMLElement) {
		node.style.width = '28rem'
		node.style.height = '38rem'
		x = Math.max(MARGIN, window.innerWidth - node.offsetWidth - MARGIN)
		y = Math.max(MARGIN, window.innerHeight - node.offsetHeight - MARGIN)
	}

	function toggleMinimize() {
		if (!panel) return
		if (!minimized) {
			savedHeight = panel.style.height
			panel.style.height = 'auto'
		} else {
			panel.style.height = savedHeight || '38rem'
		}
		minimized = !minimized
	}

	let dragging = false
	let offsetX = 0
	let offsetY = 0
	function startDrag(e: PointerEvent) {
		// Don't hijack clicks on the header buttons/links.
		if ((e.target as HTMLElement).closest('button, a')) return
		dragging = true
		offsetX = e.clientX - x
		offsetY = e.clientY - y
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
	}
	function onDrag(e: PointerEvent) {
		if (!dragging) return
		const w = panel?.offsetWidth ?? 448
		x = Math.min(Math.max(e.clientX - offsetX, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN))
		y = Math.min(Math.max(e.clientY - offsetY, MARGIN), window.innerHeight - 48)
	}
	function endDrag() {
		dragging = false
	}
</script>

<div
	bind:this={panel}
	use:initWindow
	class="fixed z-50 flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-lg border bg-background shadow-xl {minimized
		? ''
		: 'resize min-h-[16rem] min-w-[22rem]'}"
	style="left: {x}px; top: {y}px;"
	role="dialog"
	aria-label="Payroll calculator"
>
	<div
		class="flex shrink-0 cursor-move select-none items-center justify-between border-b bg-muted/50 px-3 py-2"
		onpointerdown={startDrag}
		onpointermove={onDrag}
		onpointerup={endDrag}
	>
		<span class="text-sm font-semibold">Payroll Calculator</span>
		<div class="flex items-center gap-1">
			<a
				href="/payroll/calculator"
				title="Open full page"
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.8"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
					/>
				</svg>
			</a>
			<button
				type="button"
				title={minimized ? 'Restore' : 'Minimize'}
				onclick={toggleMinimize}
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.8"
					stroke="currentColor"
				>
					{#if minimized}
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
					{:else}
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" />
					{/if}
				</svg>
			</button>
			<button
				type="button"
				title="Close"
				onclick={onclose}
				class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.8"
					stroke="currentColor"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto p-4" hidden={minimized}>
		<CalculatorPanel {employees} {recurringDefaults} stacked />
	</div>
</div>
