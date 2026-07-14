import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { ROLE_HIERARCHY } from '$lib/server/rbac';
import { listPunches } from '$lib/server/services/timelog';
import { apiError } from '$lib/server/api-error';
import type { RequestHandler } from './$types';

// GET /api/v1/timesheets/:employeeId/punches?from=&to=
// List raw TimeLog punches for an employee within an optional [from, to] window.
// Access: the owner, the owner's manager, HR_ADMIN, or SUPER_ADMIN.
// (`params.id` is the employeeId — the segment reuses the existing [id] param name,
// which SvelteKit requires for sibling dynamic routes.)
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const user = locals.user;
	const employeeId = params.id;

	// Resolve the target employee (scoped to the caller's org).
	const target = await db.employee.findFirst({
		where: { id: employeeId, organizationId: user.organizationId },
		select: { id: true, userId: true, reportsToId: true }
	});
	if (!target) return apiError(404, 'Employee not found');

	// HR_ADMIN and above see any employee's punches; otherwise the caller must be
	// the owner or the owner's direct manager.
	const isHrOrAbove = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY.HR_ADMIN;
	if (!isHrOrAbove) {
		const requester = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		});
		const isOwner = requester?.id === target.id;
		const isManager = requester != null && target.reportsToId === requester.id;
		if (!isOwner && !isManager) return apiError(403, 'Insufficient permissions');
	}

	// Optional window; reject unparseable dates.
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	const from = fromParam ? new Date(fromParam) : undefined;
	const to = toParam ? new Date(toParam) : undefined;
	if (from && isNaN(from.getTime())) return apiError(400, 'Invalid "from" date');
	if (to && isNaN(to.getTime())) return apiError(400, 'Invalid "to" date');

	const punches = await listPunches(target.id, { from, to });
	return json({ data: punches, count: punches.length });
};
