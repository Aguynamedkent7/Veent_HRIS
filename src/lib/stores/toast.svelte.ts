// Shared toast store (Svelte 5 runes). Import the functions anywhere; render with
// <Toaster/> once in the app layout.

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
	id: string
	message: string
	link?: string | null
	kind: ToastKind
}

let toasts = $state<Toast[]>([])

export function getToasts(): Toast[] {
	return toasts
}

export function addToast(
	message: string,
	opts: { link?: string | null; kind?: ToastKind; timeout?: number } = {}
): string {
	const id = crypto.randomUUID()
	toasts.push({ id, message, link: opts.link ?? null, kind: opts.kind ?? 'info' })
	const timeout = opts.timeout ?? 6000
	if (timeout > 0) setTimeout(() => dismissToast(id), timeout)
	return id
}

export function dismissToast(id: string): void {
	toasts = toasts.filter((t) => t.id !== id)
}
