import { json } from '@sveltejs/kit'

export function apiError(status: number, message: string, details?: unknown) {
	return json({ error: message, details }, { status })
}

export function notFound(resource = 'Resource') {
	return apiError(404, `${resource} not found`)
}

export function forbidden() {
	return apiError(403, 'Insufficient permissions')
}

export function badRequest(message: string, details?: unknown) {
	return apiError(400, message, details)
}

export function conflict(message: string) {
	return apiError(409, message)
}
