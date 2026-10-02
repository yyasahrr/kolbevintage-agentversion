# ADR-0003: Use PostgreSQL with Versioned SQL Migrations

- **Status:** Accepted
- **Date:** 2026-10-01
- **Scope:** Persistence foundation

## Context

The platform will store identity, permissions, inventory movements, orders, payments, refunds, settlements, and audit records. These domains need relational constraints, transactions, unique ownership boundaries, deterministic timestamps, and explicit append-oriented records. The repository had no existing database or ORM contract.

## Decision

Use PostgreSQL as the primary transactional database and maintain schema changes as ordered SQL files under `db/migrations/`.

- `pg` is the initial Node database driver.
- `scripts/migrate.mjs` applies migrations in filename order and records each applied version in `schema_migrations`.
- Each migration runs inside a transaction and is not silently rewritten after application.
- The application readiness check requires the latest known migration (`0002_seed_access`) to be applied; a reachable but unmigrated database is not considered ready.
- PostgreSQL constraints, indexes, foreign keys, and check constraints are part of the domain integrity boundary, not only application validation.
- Production database credentials are supplied through environment/secret management; they are never stored in Git or logged.
- The initial identity schema uses UUID identifiers, UTC-capable `timestamptz` values, and text/JSONB fields only where their bounded purpose is explicit.

An ORM is intentionally deferred. The first schemas are small enough for reviewed SQL, and explicit SQL keeps financial/inventory constraints visible. Reconsider an ORM only if it improves migration safety or domain productivity without hiding transaction and constraint behavior.

## Consequences

### Positive

- Strong relational constraints for identity, role assignment, sessions, and audit records.
- Explicit migration review and transactional application.
- Straightforward operational model for local, CI, staging, and production.
- No abstraction hides the SQL required for inventory and financial integrity.

### Negative

- SQL types and row mapping need careful review in TypeScript.
- Migration rollback must be handled by forward corrective migrations unless a down migration is provably safe.
- A connection pool and database availability are operational dependencies.
- Integration tests require a PostgreSQL service; unit tests alone are not sufficient.

### Safeguards

- Never use floating-point types for money; use minor units or database Decimal in finance modules.
- Do not expose database rows directly as API responses; use domain DTOs.
- Keep migration filenames deterministic and avoid editing applied migrations.
- Add unique/check/foreign-key constraints for every critical invariant that belongs in the database.
- Run migrations and identity integration tests in CI with PostgreSQL.
- Keep reports bounded and separate from transaction-heavy workflows as scale grows.

## Alternatives considered

### SQLite

Rejected as the production source of truth. It is useful for isolated prototypes but does not match the expected PostgreSQL deployment/transaction behavior and would allow integration behavior to diverge.

### PostgreSQL plus an ORM immediately

Deferred. The repository has no existing ORM model to preserve, and the identity foundation benefits from visible SQL constraints. The choice can be revisited with evidence.

### No database until UI exists

Rejected. Authentication, ownership, inventory, money, and API authorization must be server/data-backed before production UI flows are built.

## Review triggers

Revisit this ADR if:

- The selected hosting platform requires a different managed relational database.
- Migration volume or team workflow shows a measurable need for additional tooling.
- Read/reporting load requires a read model or analytics store.
- Database scale, tenancy, compliance, or fault-isolation requirements change.
