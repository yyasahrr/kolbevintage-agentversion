# ADR-0001: Start with a Modular Monolith and Shared Commerce Core

- **Status:** Accepted as the initial implementation constraint
- **Date:** 2026-10-01
- **Scope:** Initial architecture for the currently empty repository
- **Decision owners:** Project engineering team

## Context

The repository contains no existing application, database, API, deployment, or runtime implementation. The product requirements describe Retail Commerce, Wholesale Commerce, supplier workflows, central warehouse inventory, finance, CRM, operations, and retail intelligence. Retail and Wholesale have different business rules but must share users, products, inventory, orders, and core platform capabilities.

Starting with independent Retail and Wholesale backends would duplicate identity, catalog, inventory, authorization, and financial behavior. Starting with microservices would add network boundaries, deployment overhead, distributed failure modes, and contract/versioning work before the repository has a working domain model or measured scaling requirement.

## Decision

Build the first production-capable version as a **modular monolith with one shared core**:

- One deployable backend owns shared identity, catalog, inventory, orders, finance, and audit primitives.
- Retail and Wholesale are explicit market contexts/policies over those primitives, not duplicate systems.
- Supplier functionality is a bounded module with strict resource ownership and public/private data projections.
- Warehouse and inventory are a bounded module with an append-oriented ledger and transactional reservations.
- Finance and supplier wallet are a bounded module with traceable money movements and explicit currency.
- External providers are isolated behind small adapters and never become the source of truth for business-critical state.
- A queue, cache, search engine, separate service, or workflow engine is introduced only after a specific requirement, operational owner, failure/recovery plan, and measurement justify it.

The initial logical boundaries are:

```text
Platform Core
├── Identity + Access Policy
├── Wholesale Membership
├── Supplier
├── Catalog
├── Warehouse + Inventory
├── Commerce + Orders
├── Finance + Wallet + Settlement
├── Pricing + Promotions
├── Shipping + Returns + Support
├── CRM + Marketing
├── Retail Intelligence
└── CMS + Reporting + Operations
```

These are code and data boundaries inside one deployable system. They are not promises of separate network services.

## Consequences

### Positive

- One source of truth for authorization, products, stock, orders, and money.
- Smaller initial operational footprint and simpler local development/deployment.
- Transactions can cover the critical data that must change together.
- Domain boundaries remain explicit and can be extracted later if real scale or team boundaries require it.
- Supplier privacy and Retail/Wholesale rules can be tested centrally.

### Negative

- Module boundaries must be enforced by code review and dependency rules rather than network isolation.
- A badly coupled module can still affect the whole deployment.
- Future extraction will require deliberate contract and data ownership work.
- A single database needs query discipline and reporting isolation as traffic grows.

### Required safeguards

- Keep modules organized by domain, not by generic controller/model/helper folders alone.
- Prevent direct cross-module writes to another module's tables where a service/domain operation is required.
- Require authorization and validation at the API boundary and ownership checks in domain services.
- Use append-oriented inventory and financial ledgers instead of silent balance edits.
- Add integration, concurrency, authorization, and E2E tests around critical workflows.
- Document a future extraction trigger before splitting a module: independent scaling, independent deployment, team ownership, or fault isolation.

## Alternatives considered

### Separate Retail and Wholesale backends

Rejected. It violates the shared-core requirement and creates duplicated user, product, inventory, authorization, and financial behavior that can diverge.

### Microservices from the beginning

Rejected for the current repository. There is no existing scale, team boundary, or independent deployment need to justify the operational cost and distributed consistency risks.

### Serverless/functions without a domain core

Rejected as an initial architecture. Functions can be used by a chosen runtime where appropriate, but they do not replace shared domain ownership, transactions, ledgers, authorization, and testable contracts.

### General-purpose workflow engine as source of truth

Rejected. n8n or a similar system may orchestrate notifications and integrations later, but business-critical state remains in the core backend/database.

## Review triggers

Revisit this ADR only when evidence shows one or more of the following:

- A module needs independent scaling that the monolith cannot provide.
- A module needs an independent deployment cadence or fault-isolation boundary.
- Team ownership requires a separate service and the data contract is explicit.
- Database or queue workload is measured and the current deployment cannot meet the SLO.
- A provider or regulatory boundary requires isolation.

Any revision must include migration, data ownership, idempotency, observability, rollback, and recovery plans.
