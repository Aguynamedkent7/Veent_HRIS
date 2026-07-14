# API Contract: Authentication

**Base path**: `/api/v1/auth`
**Auth required**: None (these endpoints are public)

---

## POST /api/v1/auth/login

Log in and receive JWT tokens.

**Request body**:

```json
{ "email": "string", "password": "string" }
```

**Response 200**:

```json
{
	"accessToken": "string (JWT, 15m TTL)",
	"refreshToken": "string (JWT, 7d TTL)",
	"user": {
		"id": "uuid",
		"email": "string",
		"role": "EMPLOYEE | MANAGER | HR_ADMIN | SUPER_ADMIN",
		"employeeId": "uuid | null"
	}
}
```

**Response 401**: Invalid credentials.
**Side effect**: Successful login recorded in AuditLog (`action: LOGIN`). Failed attempt recorded (`action: LOGIN_FAILED`).

---

## POST /api/v1/auth/refresh

Exchange a valid refresh token for a new access token.

**Request body**: `{ "refreshToken": "string" }`

**Response 200**: `{ "accessToken": "string" }`

**Response 401**: Expired or invalid refresh token.

---

## POST /api/v1/auth/logout

Invalidate the current session (refresh token blacklisted in Redis).

**Auth**: Bearer access token required.

**Response 204**: No content.

---

## POST /api/v1/auth/change-password

**Auth**: Bearer access token required (any role).

**Request body**: `{ "currentPassword": "string", "newPassword": "string" }`

**Password rules**: min 8 chars, at least 1 uppercase, 1 number.

**Response 204**: No content.

**Response 400**: Validation error or current password incorrect.
