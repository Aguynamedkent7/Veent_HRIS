<script lang="ts">
	import { formatDateISO } from '$lib/utils/dates'

	interface Entry {
		date: Date
		hoursWorked: number
		notes?: string
	}

	let {
		entries,
		readonly = false,
		onchange
	}: {
		entries: Entry[]
		readonly?: boolean
		onchange?: (entries: Entry[]) => void
	} = $props()

	const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

	// Build a 7-slot array aligned Mon-Sun from the provided entries
	function buildSlots(src: Entry[]): (Entry & { _dayIndex: number })[] {
		return DAY_LABELS.map((_, i) => {
			// Day index: 1=Mon ... 6=Sat, 0=Sun → we want Mon=0 ... Sun=6
			// getDay(): 0=Sun,1=Mon...6=Sat  →  (getDay() + 6) % 7 gives Mon=0..Sun=6
			const match = src.find((e) => (e.date.getDay() + 6) % 7 === i)
			return match
				? { ...match, _dayIndex: i }
				: { date: new Date(), hoursWorked: 0, notes: '', _dayIndex: i }
		})
	}

	let slots = $state(buildSlots(entries))

	$effect(() => {
		slots = buildSlots(entries)
	})

	let totalHours = $derived(slots.reduce((sum, s) => sum + (s.hoursWorked || 0), 0))

	function updateHours(index: number, value: string) {
		const parsed = Math.min(24, Math.max(0, parseFloat(value) || 0))
		slots[index] = { ...slots[index], hoursWorked: parsed }
		if (onchange) {
			onchange(slots.map(({ _dayIndex: _i, ...rest }) => rest))
		}
	}

	function updateNotes(index: number, value: string) {
		slots[index] = { ...slots[index], notes: value }
		if (onchange) {
			onchange(slots.map(({ _dayIndex: _i, ...rest }) => rest))
		}
	}
</script>

<div class="overflow-x-auto rounded-md border">
	<table class="w-full text-sm">
		<thead class="bg-muted/50 border-b">
			<tr>
				{#each DAY_LABELS as label}
					<th class="px-3 py-2 text-center font-medium text-muted-foreground">{label}</th>
				{/each}
				<th class="px-3 py-2 text-center font-medium text-muted-foreground">Total</th>
			</tr>
		</thead>
		<tbody>
			<!-- Date row -->
			<tr class="border-b">
				{#each slots as slot}
					<td class="px-3 py-2 text-center text-xs text-muted-foreground">
						{formatDateISO(slot.date)}
					</td>
				{/each}
				<td></td>
			</tr>
			<!-- Hours row -->
			<tr class="border-b">
				{#each slots as slot, i}
					<td class="px-2 py-2 text-center">
						<input
							type="number"
							min="0"
							max="24"
							step="0.5"
							value={slot.hoursWorked}
							disabled={readonly}
							onchange={(e) => updateHours(i, (e.target as HTMLInputElement).value)}
							class="w-16 rounded-md border border-input bg-background px-2 py-1 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						/>
					</td>
				{/each}
				<td class="px-3 py-2 text-center font-semibold">
					{totalHours.toFixed(1)}h
				</td>
			</tr>
			<!-- Notes row -->
			<tr>
				{#each slots as slot, i}
					<td class="px-2 py-2">
						<input
							type="text"
							placeholder="Notes"
							value={slot.notes ?? ''}
							disabled={readonly}
							oninput={(e) => updateNotes(i, (e.target as HTMLInputElement).value)}
							class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						/>
					</td>
				{/each}
				<td></td>
			</tr>
		</tbody>
	</table>
</div>
