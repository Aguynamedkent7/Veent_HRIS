<script lang="ts">
	interface DataPoint {
		period: string
		headcount: number
	}

	let { data }: { data: DataPoint[] } = $props()

	const PADDING = { top: 20, right: 20, bottom: 60, left: 50 }
	const WIDTH = 600
	const HEIGHT = 280

	const chartWidth = WIDTH - PADDING.left - PADDING.right
	const chartHeight = HEIGHT - PADDING.top - PADDING.bottom

	const maxVal = $derived(data.length > 0 ? Math.max(...data.map((d) => d.headcount)) : 0)
	const minVal = 0

	function xPos(i: number): number {
		if (data.length <= 1) return chartWidth / 2
		return (i / (data.length - 1)) * chartWidth
	}

	function yPos(val: number): number {
		if (maxVal === minVal) return chartHeight / 2
		return chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight
	}

	const linePath = $derived(() => {
		if (data.length === 0) return ''
		return data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(d.headcount)}`).join(' ')
	})

	// Y axis tick values — 5 evenly spaced
	const yTicks = $derived(() => {
		const count = 5
		const step = maxVal === 0 ? 1 : Math.ceil(maxVal / (count - 1))
		return Array.from({ length: count }, (_, i) => i * step)
	})
</script>

{#if data.length === 0}
	<div class="flex h-40 items-center justify-center text-sm text-muted-foreground">
		No data available
	</div>
{:else}
	<div class="w-full overflow-x-auto">
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			class="w-full"
			aria-label="Headcount trend line chart"
			role="img"
		>
			<g transform="translate({PADDING.left},{PADDING.top})">
				<!-- Y axis grid lines + labels -->
				{#each yTicks() as tick}
					<line
						x1="0"
						y1={yPos(tick)}
						x2={chartWidth}
						y2={yPos(tick)}
						stroke="#e5e7eb"
						stroke-width="1"
					/>
					<text
						x="-8"
						y={yPos(tick)}
						dominant-baseline="middle"
						text-anchor="end"
						font-size="11"
						fill="#6b7280"
					>
						{tick}
					</text>
				{/each}

				<!-- X axis labels (rotated 45°) -->
				{#each data as d, i}
					<text
						x={xPos(i)}
						y={chartHeight + 8}
						text-anchor="end"
						font-size="10"
						fill="#6b7280"
						transform="rotate(-45 {xPos(i)} {chartHeight + 8})"
					>
						{d.period}
					</text>
				{/each}

				<!-- Axes -->
				<line x1="0" y1="0" x2="0" y2={chartHeight} stroke="#d1d5db" stroke-width="1" />
				<line
					x1="0"
					y1={chartHeight}
					x2={chartWidth}
					y2={chartHeight}
					stroke="#d1d5db"
					stroke-width="1"
				/>

				<!-- Line path -->
				<path
					d={linePath()}
					fill="none"
					stroke="#3b82f6"
					stroke-width="2"
					stroke-linejoin="round"
				/>

				<!-- Area fill -->
				{#if data.length > 1}
					<path
						d="{linePath()} L {xPos(data.length - 1)} {chartHeight} L {xPos(0)} {chartHeight} Z"
						fill="#3b82f6"
						fill-opacity="0.08"
					/>
				{/if}

				<!-- Dots -->
				{#each data as d, i}
					<circle
						cx={xPos(i)}
						cy={yPos(d.headcount)}
						r="4"
						fill="#3b82f6"
						stroke="#fff"
						stroke-width="2"
					>
						<title>{d.period}: {d.headcount}</title>
					</circle>
				{/each}
			</g>
		</svg>
	</div>
{/if}
