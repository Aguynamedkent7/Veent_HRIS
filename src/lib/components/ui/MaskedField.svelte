<script lang="ts">
	import type { Snippet } from 'svelte'

	// Display-only definition-list cell for a masked-by-default sensitive field (#111): renders
	// the revealed cleartext when the audited reveal has run (`value`), otherwise the server
	// mask, falling back to an em dash. `children` renders inline after the value for per-field
	// enrichments (e.g. a legacy-format warning) that only make sense once the value is revealed.
	let {
		label,
		masked,
		value = null,
		mono = false,
		children
	}: {
		label: string
		masked: string | null
		value?: string | null
		mono?: boolean
		children?: Snippet
	} = $props()
</script>

<dt class="text-muted-foreground">{label}</dt>
<dd class:font-mono={mono}>
	{value ?? masked ?? '—'}
	{@render children?.()}
</dd>
