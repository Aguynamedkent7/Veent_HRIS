/**
 * Resolve where a back button should point.
 *
 * Priority: the page actually navigated from (captured client-side) → a `?from`
 * deep-link hint → the page's static fallback. The `?from` value is only honored
 * when it is an app-relative path (single leading `/`), so a crafted link can't
 * send the user off-site.
 */
export function resolveBackTarget(
	cameFrom: string | null,
	fromParam: string | null,
	fallback: string,
	preferFallback = false
): string {
	// `preferFallback` makes Back move UP instead of sideways: a captured origin that is a
	// sibling *under* the fallback is ignored. Settings needs this — hopping between tabs
	// otherwise makes each tab's Back point at the previous tab, and the section index
	// becomes unreachable. It stays opt-in because /requests/[id] deliberately goes back
	// sideways to /requests/approvals.
	const sideways =
		preferFallback && cameFrom != null && pathnameOf(cameFrom).startsWith(`${fallback}/`)
	if (cameFrom && !sideways) return cameFrom
	if (fromParam && fromParam.startsWith('/') && !fromParam.startsWith('//')) return fromParam
	return fallback
}

/**
 * Label for the back button: the destination name when the resolved target really
 * is the fallback page, generic "Back" otherwise — so "← Employees" never points
 * at /team.
 */
export function backLabel(target: string, fallback: string, label: string): string {
	return pathnameOf(target) === pathnameOf(fallback) ? label : 'Back'
}

function pathnameOf(path: string): string {
	const end = path.search(/[?#]/)
	return end === -1 ? path : path.slice(0, end)
}
