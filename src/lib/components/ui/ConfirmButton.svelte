<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import type { Snippet } from 'svelte'
	import ConfirmDialog from './ConfirmDialog.svelte'

	interface Props {
		/** Form action to POST on confirm, e.g. "?/deleteDocument". */
		action: string
		title?: string
		message?: string
		confirmText?: string
		/** Trigger button label + styling. */
		triggerLabel?: string
		triggerClass?: string
		disabled?: boolean
		/** Optional enhance handler (e.g. to clear a selection / close a modal on success). */
		submit?: SubmitFunction
		/** Hidden inputs to include in the form (ids, etc.). */
		children?: Snippet
	}

	let {
		action,
		title = 'Delete?',
		message = 'This action cannot be undone.',
		confirmText = 'Delete',
		triggerLabel = 'Delete',
		triggerClass = 'text-sm font-medium text-destructive hover:underline',
		disabled = false,
		submit,
		children
	}: Props = $props()

	let open = $state(false)
	let formEl = $state<HTMLFormElement>()

	const noop: SubmitFunction = () => {}
</script>

<form method="POST" {action} use:enhance={submit ?? noop} bind:this={formEl} class="contents">
	{@render children?.()}
	<button type="button" {disabled} onclick={() => (open = true)} class={triggerClass}
		>{triggerLabel}</button
	>
</form>

<ConfirmDialog
	bind:open
	{title}
	{message}
	{confirmText}
	onconfirm={() => formEl?.requestSubmit()}
/>
