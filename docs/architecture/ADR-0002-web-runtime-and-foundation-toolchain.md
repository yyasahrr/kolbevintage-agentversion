# ADR-0002: Use Next.js and TypeScript for the Initial Web Runtime

- **Status:** Accepted
- **Date:** 2026-10-01
- **Scope:** Phase 0 runtime and quality foundation

## Context

The repository was empty apart from documentation. The platform needs Retail, Wholesale, Admin, and Supplier experiences plus server-authoritative APIs. There is no existing framework or API contract to preserve. The first implementation must remain a modular monolith, keep the browser and server in one deployable product boundary, and provide a strict TypeScript/test foundation without introducing separate services prematurely.

## Decision

Use the following initial toolchain:

- **Next.js 16 App Router** as the web runtime and deployable application boundary.
- **React 19** for the UI surface.
- **TypeScript 5.9** with strict checking and bundler module resolution.
- **Zod 4** for server-side runtime configuration and future request/domain schemas.
- **Vitest 5** for unit and route-level tests.
- **ESLint 9 + eslint-config-next** for code quality checks.
- **npm lockfile** for reproducible dependency installation in this repository.
- **Node.js 22.22.3** as the current development/CI runtime, declared in `.nvmrc` and `package.json` engines.

API route handlers live under the same application boundary as the UI. Domain logic will be placed in domain-focused server modules rather than embedded in page components or route handlers. PostgreSQL with versioned SQL migrations is now selected for the identity/data foundation; see [ADR-0003](ADR-0003-postgresql-and-sql-migrations.md).

The initial runtime exposes:

- `GET /api/health` — liveness only; returns `200` when the process is responding.
- `GET /api/ready` — readiness; currently returns `503` because persistence is not configured yet.

## Consequences

### Positive

- One initial deployable unit for UI and API behavior.
- Shared TypeScript types and validation can be introduced without a second package/service boundary.
- Next.js provides production build output and route handling while the domain remains framework-independent.
- Strict typecheck, lint, tests, environment validation, and production build run locally and in CI.

### Negative

- Server and UI deployment scale together until a measured need says otherwise.
- Next.js conventions must be kept away from core domain logic to preserve future portability.
- API versioning and module boundaries still need to be designed before business APIs are added.

### Safeguards

- Do not put money, inventory, membership, or authorization truth in React state.
- Keep sensitive route handlers server-only and validate all external input.
- Keep the error envelope and request-correlation conventions stable.
- Add database, session, and provider dependencies only behind focused modules and tests.
- Revisit the runtime only with measured performance, deployment, team, or fault-isolation evidence.

## Alternatives considered

### Separate React frontend and API service

Deferred. It would add a network boundary and duplicate local setup before a stable domain/API contract exists. The shared-core requirement does not require separate deployments.

### Express/Fastify-only API plus a separate frontend

Deferred for the same reason. A standalone API may become appropriate if the product later needs independent clients or scaling, but it is not required by the current repository.

### Unvalidated JavaScript prototype

Rejected. The system will contain money, inventory, privacy, and authorization rules; strict typing and executable tests are required from the first batch.

## Review triggers

Revisit this ADR if:

- A separately deployed client has a stable, versioned API contract.
- UI/API scaling or fault isolation is measured as a real constraint.
- Next.js creates a demonstrated boundary problem for a domain module.
- Team ownership requires independent deployment with a migration and observability plan.
