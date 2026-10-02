# kolbevintage-agentversion

## Current status

**Discovery is complete; platform, identity, supplier/wholesale, and catalog foundations are in progress.** The repository now has a Next.js/TypeScript runtime, PostgreSQL migrations, authentication/session routes with database-backed abuse limits, baseline security headers, supplier application/review APIs, wholesale eligibility checks, seller-owned catalog/variant APIs, health/readiness checks, structured logging, tests, and CI quality gates. Inventory integrity now includes central warehouse receiving/QC, inbound shipments, transfers, adjustments, holds, and transactional reservations. A shared Retail/Wholesale order snapshot and state-machine foundation plus versioned base-merchandise pricing are also present; warehouse administration, shipping/returns, discounts/tax/shipping pricing, checkout/payment, finance, and commerce fulfillment flows are intentionally not implemented yet.

## Project documents

- [Full repository audit](docs/audit/repository-audit.md)
- [Feature matrix](docs/audit/feature-matrix.csv)
- [Dependency-aware implementation plan](docs/architecture/implementation-plan.md)
- [ADR-0001: Modular monolith and shared commerce core](docs/architecture/ADR-0001-modular-monolith-and-shared-core.md)
- [ADR-0002: Web runtime and foundation toolchain](docs/architecture/ADR-0002-web-runtime-and-foundation-toolchain.md)
- [ADR-0003: PostgreSQL and SQL migrations](docs/architecture/ADR-0003-postgresql-and-sql-migrations.md)
- [Authentication API contract](docs/api/authentication.md)
- [Supplier and Wholesale API contract](docs/api/supplier-and-wholesale.md)
- [Catalog API contract](docs/api/catalog.md)
- [Warehouse and Inventory API contract](docs/api/inventory.md)
- [Order foundation contract](docs/api/orders.md)
- [Pricing foundation contract](docs/api/pricing.md)

Do not treat a feature as complete until its server-side business rules, authorization, data integrity, tests, and relevant UI/API flow are implemented and verified.
