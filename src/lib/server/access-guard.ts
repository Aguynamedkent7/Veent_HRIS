// #193: offboarding deactivates the employee's login (User.isActive = false — set by
// offboardEmployee and finalizeSeparation). The auth hook must then block any session the
// offboarded employee still holds, sending them to the disabled-account screen. This pure
// predicate is exactly what the hook enforces, so the rule can be regression-tested.

/** True when a request's resolved user should be denied access (an offboarded / disabled login). */
export function isSessionBlocked(user: { isActive: boolean } | null): boolean {
	return user != null && !user.isActive
}
