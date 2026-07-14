<script lang="ts">
	import { formatCurrency } from '$lib/utils/format'

	interface DataPoint {
		department: string
		totalGross: number
	}

	let { data }: { data: DataPoint[] } = $props()

	const BAR_HEIGHT = 32
	const BAR_GAP = 12
	const LABEL_WIDTH = 160
	const VALUE_WIDTH = 100
	const CHART_WIDTH = 400
	const PADDING = { top: 16, right: VALUE_WIDTH + 8, bottom: 16, left: LABEL_WIDTH }

	const maxVal = $derived(data.length > 0 ? Math.max(...data.map((d) => d.totalGross)) : 0)

	const svgHeight = $derived(
		PADDING.top + data.length * (BAR_HEIGHT + BAR_GAP) - BAR_GAP + PADDING.bottom
	)

	function barWidth(val: number): number {
		if (maxVal === 0) return 0
		return (val / maxVal) * CHART_WIDTH
	}

	// Color palette — cycles through
	const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']
	function color(i: number): string {
		return COLORS[i % COLORS.length]
	}
</script>

{#if data.length === 0}
	<div class="flex h-40 items-center justify-center text-sm text-muted-foreground">
		No data available
	</div>
{:else}
	<div class="w-full overflow-x-auto">
		<svg
			viewBox="0 0 {PADDING.left + CHART_WIDTH + PADDING.right} {svgHeight}"
			class="w-full"
			aria-label="Payroll cost by department bar chart"
			role="img"
		>
			{#each data as d, i}
				{@const y = PADDING.top + i * (BAR_HEIGHT + BAR_GAP)}
				{@const bw = barWidth(d.totalGross)}

				<!-- Department label -->
				<text
					x={PADDING.left - 8}
					y={y + BAR_HEIGHT / 2}
					text-anchor="end"
					dominant-baseline="middle"
					font-size="12"
					fill="#374151"
				>
					{d.department.length > 22 ? d.department.slice(0, 20) + '…' : d.department}
				</text>

				<!-- Bar -->
				<rect x={PADDING.left} {y} width={bw} height={BAR_HEIGHT} fill={color(i)} rx="3" ry="3">
					<title>{d.department}: {formatCurrency(d.totalGross)}</title>
				</rect>

				<!-- Value label to the right of bar -->
				<text
					x={PADDING.left + bw + 6}
					y={y + BAR_HEIGHT / 2}
					dominant-baseline="middle"
					font-size="11"
					fill="#6b7280"
				>
					{formatCurrency(d.totalGross)}
				</text>
			{/each}
		</svg>
	</div>
{/if}
