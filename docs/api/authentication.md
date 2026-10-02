# Authentication API

**Status:** Phase 1 partial. These endpoints are real database-backed contracts with authentication abuse limits and baseline security headers; account recovery, verification, and complete authorization middleware are still pending.

## Prerequisites

1. Start PostgreSQL.
2. Copy `.env.example` to `.env` and set a non-committed `DATABASE_URL`.
3. Apply migrations:

```bash
npm run db:migrate
```

The application readiness endpoint remains `503` until the latest migration is applied.

## Session model

- Sessions are opaque random tokens stored only in an `HttpOnly` cookie.
- Only a SHA-256 hash of the session token is stored in `auth_sessions`.
- Cookies use `SameSite=Lax`, `Path=/`, and `Secure` in production.
- Session lifetime is 30 days.
- The API never returns the raw session token in JSON.
- Logout is idempotent for a missing session and revokes a matching server-side session.

## Endpoints

### `POST /api/v1/auth/register`

Request:

```json
{
  "email": "buyer@example.com",
  "password": "A secure password with 12+ chars"
}
```

Responses:

- `201` — user projection and session expiry; sets the session cookie.
- `400` — malformed JSON or invalid email/password shape.
- `409` — normalized email already exists.
- `429` — registration limit reached; includes `Retry-After`.
- `503` — database or migration is unavailable.

### `POST /api/v1/auth/login`

Uses the same request shape.

Responses:

- `200` — user projection and session expiry; sets the session cookie.
- `400` — malformed or invalid input.
- `401` — generic invalid credentials/status response; does not reveal whether the email exists.
- `429` — login limit reached; includes `Retry-After`.
- `503` — database or migration is unavailable.

### `GET /api/v1/auth/me`

Reads the current `kolbe_session` cookie and returns the authenticated user's public account projection.

Responses:

- `200` — `{ "user": { "id", "email", "status", "roles" } }`.
- `401` — no active session.
- `503` — database or migration is unavailable.

### `POST /api/v1/auth/logout`

Revokes the matching session when present and always sends an expired session cookie.

Responses:

- `200` — session cleared.
- `503` — cookie cleared, but server-side revocation could not be confirmed.

## Common response headers

- `cache-control: no-store` on all auth responses.
- `x-request-id` is echoed or generated for correlation.
- Baseline security headers are applied by the Next.js proxy; HSTS is enabled in production only.
- Rate-limited responses include `retry-after` seconds.

## Known limitations before production

- Registration currently creates an active account; email verification is not implemented yet.
- Password reset/OTP/MFA is not implemented.
- Rate limits use database buckets keyed by HMACs of normalized email and proxy-provided network identifiers; production must set `AUTH_RATE_LIMIT_SECRET`, and bucket retention/monitoring remains an operational task.
- Password-reset-specific abuse controls are not implemented.
- Roles and permissions are seeded, but business routes still need permission and resource-ownership enforcement.
- The PostgreSQL integration test runs in CI when the PostgreSQL service is available; local execution skips it when `DATABASE_URL` is absent.
