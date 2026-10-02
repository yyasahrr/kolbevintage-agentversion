# Dependency-Aware Implementation Plan

**Status:** Discovery complete; Phase 0 complete; Identity/Supplier/Wholesale/Catalog foundations in progress; inventory foundation now includes receiving/QC, transfers, adjustments, and holds.
**Source:** `docs/audit/repository-audit.md` and the project business invariants
**Principle:** Smallest correct change, shared core, server-authoritative business rules.

## Current progress

### Phase 0 — Complete

Implemented:

- Next.js 16 / React 19 / TypeScript 5.9 runtime.
- npm lockfile and Node 22 runtime contract.
- `.env.example` plus placeholder-only environment validation.
- Strict typecheck, ESLint, Vitest, production build, and GitHub Actions quality gates.
- `GET /api/health` liveness endpoint.
- `GET /api/ready` readiness endpoint that correctly returns `503` until persistence exists.
- Structured redacted logging and request-correlation IDs.
- Stable no-store HTTP error response primitive.
- Minimal accessible foundation status page.

### Identity foundation — Partial

Implemented:

- PostgreSQL connection pool and environment validation.
- Transaction helper and ordered SQL migration runner.
- Identity schema for users, sessions, roles, permissions, role assignments, and audit records.
- Seeded initial system role/permission vocabulary.
- Scrypt password hashing with bounded verification parameters.
- HttpOnly SameSite session cookies with hashed server-side tokens.
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, and idempotent `POST /api/v1/auth/logout`.
- Database-backed identity integration test, executed when PostgreSQL is available in CI.
- Database-backed login/registration rate-limit buckets keyed by HMACs of email and network identifiers.
- Authentication rate-limit responses include `429`, `Retry-After`, and a bounded retry duration.
- Security headers are applied by the Next.js 16 `proxy` boundary; HSTS is production-only.
- Readiness now requires the latest database migration to be applied; an unmigrated database remains `503`.

Still required before identity is production-ready:

- Password reset/email or OTP verification policy.
- Password reset/email or OTP verification policy and account recovery abuse controls.
- Complete permission middleware and resource ownership helpers on business APIs.
- Full audit-log service and actor/metadata coverage for sensitive operations.
- Verified CI PostgreSQL integration run and a local documented restore/test workflow.

### Supplier and Wholesale foundation — Partial

Implemented:

- Wholesale account, plan, membership, and entitlement schema.
- Supplier application state machine and append-only transition events.
- Supplier application create/list/detail/submit APIs.
- Permission-protected admin review list and decision API.
- Supplier account creation on approval, supplier role assignment, and private profile persistence.
- Buyer-safe public supplier projection that never joins private supplier fields.
- Active membership window evaluation and Wholesale eligibility API.
- Wholesale supplier public-profile API requiring an active membership.
- Conditional PostgreSQL integration coverage for supplier owner isolation, approval, privacy projection, and membership eligibility.

Still required before this foundation is production-ready:

- Supplier document upload/storage validation and review UI.
- Membership plan management, purchase/payment flow, renewal, suspension, and admin assignment UI.
- Full ownership/IDOR security suite including exports and report paths.
- Supplier and Admin portal UI with permission-aware actions.

### Catalog foundation — Partial

Implemented:

- Shared product, variant, category, media, and product-event schema.
- Explicit platform/supplier seller ownership with database constraints.
- Supplier Retail prohibition enforced in request policy and database constraint.
- Extensible product/variant fashion attributes and globally unique SKU/barcode constraints.
- Draft/active/suspended/archived product state machine.
- Supplier product create/list/publish APIs with approved-supplier and permission checks.
- Platform Admin product create/publish APIs with catalog permissions.
- Bounded Retail and Wholesale catalog list/detail APIs.
- Wholesale catalog requires active server-side membership; Retail catalog only returns platform-owned products.
- Public product DTO with public-only supplier projection.

Still required before catalog is production-ready:

- Category management and catalog administration UI.
- Provider-backed secure media upload/storage, binary content scanning, thumbnails, signed access, and retention; bounded MIME/checksum metadata validation and storage-key hardening are present.
- Pricing, price history, stock, inventory availability, and reservation integration.
- Full PostgreSQL catalog integration suite in CI, search/filter contracts, and E2E coverage; a conditional ownership/visibility integration test is included and skips when no `DATABASE_URL` is configured locally.

Do not expose checkout or finance endpoints until these catalog ownership, inventory, and policy boundaries are connected to their domain services.

### Inventory foundation — Partial

Implemented:

- Central warehouses and active locations with server-side ownership checks.
- Balance projections separated from append-oriented inventory movements.
- Supplier-source integrity enforced by PostgreSQL trigger and repository checks.
- Transactional receive, final QC, reserve, and release services with row/advisory locking.
- Received units remain unavailable until an idempotent final QC split into accepted/rejected quantities.
- Idempotent receive/QC/reserve/release command boundaries and bounded quantities.
- Authorized warehouse receipt and QC APIs with `inventory:receive` and `inventory:qc` permissions.
- Inbound shipment records linked to receipts/QC and atomic paired warehouse transfers.
- Append-oriented, idempotent manual adjustments with bounded negative corrections.
- Append-oriented holds and release transitions that consume and restore unavailable quantity without changing on-hand quantity.
- Authorized adjustment and hold/release APIs with `inventory:adjust` and `inventory:hold` permissions.
- Conditional integration coverage for idempotent receive/QC, shipment over-receiving rejection, transfers, reservations, holds, releases, and concurrent oversell prevention.

Still required before inventory is production-ready:

- Shipping, returns, consumed reservations, hold expiry policy, and warehouse/location administration UI.
- Warehouse/location administration and operator UI.
- Movement retention/archival and operational monitoring policy.
- Full PostgreSQL concurrency suite in CI with a real service and order/checkout references.

### Order foundation — Started

Implemented:

- One shared Retail/Wholesale order model with market policy context rather than duplicate backends.
- Immutable catalog/seller/quantity/money snapshots for order items with integer minor units and explicit currency.
- Server-side validation of active product/variant snapshots and public Supplier fields; private Supplier fields are not copied into orders.
- Wholesale order creation boundary that requires an active, time-valid membership belonging to the buyer.
- Explicit order state machine: `draft`, `pending_payment`, `confirmed`, `processing`, `fulfilled`, and `cancelled`.
- Transactional, idempotent order creation and state transitions with append-only event history and audit records.

Still required before exposing checkout:

- Deterministic pricing/discount service and provenance.
- Inventory reservation integration and cancellation/expiry behavior.
- Payment-provider adapter, authenticated/replay-protected callbacks, and finance boundaries.
- Buyer/Wholesale/Admin order authorization and read projections.

### Pricing foundation — Started

Implemented:

- Versioned shared Retail/Wholesale variant prices with explicit currency and integer minor units.
- Transactional price replacement with advisory locking, validity intervals, retained history, actor/reason audit, and `pricing:manage` role grants.
- Deterministic base-merchandise quote service that records exact price IDs, quantities, market, currency, and evaluation time.
- Server-side active Wholesale membership validation and seller/market availability checks during quoting.
- Atomic `createPricedOrder` boundary that stores the pricing snapshot with the order without pretending to reserve inventory or complete payment.

Still required before checkout:

- Discounts/promotions, tax, shipping rates, and their provenance/versioning.
- Multi-line inventory allocation and transactional reservation integration.
- Payment-provider adapter/callback boundaries and finance ledger.

## 1. Delivery rules

1. Implement one modular monolith first; split a component only for a measured scaling, deployment, team, or fault-isolation reason.
2. Stabilize contracts before parallel domain work: identifiers, money, timestamps, API errors, authorization context, and audit metadata.
3. Keep Retail and Wholesale as market contexts over shared users, products, orders, inventory, and finance primitives.
4. No UI-only action is accepted. Every sensitive action must have a validated, authorized, auditable backend operation.
5. No financial or inventory balance is changed without a traceable movement/ledger record.
6. Every external callback and retryable command is idempotent.
7. Each batch ends with focused unit/integration tests and relevant browser flows before the next dependency is started.

## 2. Phase plan

### Phase 0 — Repository and runtime foundation

**Goal:** Make the empty repository runnable, testable, and safe to extend.

Deliverables:

- Select and document the runtime/framework based on team capability and deployment target.
- Add dependency manifest and lockfile; do not commit generated dependency directories.
- Establish source layout for shared domain modules, API, UI, and test fixtures.
- Add environment variable contract with placeholder-only `.env.example`.
- Add formatting, linting, type checking, test command, and build command.
- Add a minimal health/readiness endpoint and a safe error envelope.
- Establish UTC timestamp, identifier, request-correlation, and structured-log conventions.
- Add CI for install, lint, typecheck, tests, build, and dependency/security checks.
- Add the first ADRs for runtime/database choice once those choices are confirmed.

Exit criteria:

- A clean checkout can install, test, build, and start without secrets.
- CI runs on the branch and fails on type/lint/test/build errors.
- No business feature is represented by mock production data.

### Phase 1 — Shared data and identity core

**Dependencies:** Phase 0.

Deliverables:

- Database connection and deterministic, incremental migrations.
- User identity, secure password/OTP flow if required, sessions/tokens, password reset, logout, and session invalidation.
- Roles and permissions from actual operational needs; default-deny authorization middleware.
- Ownership helpers that require both authenticated identity and resource scope.
- Audit-log primitive for sensitive changes.
- Server-side input schemas, pagination, filtering, and consistent domain/infrastructure errors.

Required tests:

- Unauthenticated, wrong-role, wrong-owner, tampered-ID, malformed-input, and rate-limit cases.
- Session invalidation and password-reset safety.
- Audit records contain actor, action, resource, timestamp, and reason where required.

### Phase 2 — Wholesale accounts, membership, and supplier onboarding

**Dependencies:** Phase 1.

Deliverables:

- `WholesaleAccount`, membership plan, membership status/expiry, and server-side entitlements.
- Supplier application with explicit state transitions: draft, submitted, under review, changes requested, approved, rejected, suspended, disabled.
- Supplier account and public profile projection.
- Supplier private/public data separation at query, service, serializer, and API boundaries.
- Permission matrix for customer, wholesale buyer, supplier, warehouse, support, finance, marketing, manager, admin, and super-admin roles as actually needed.

Required tests:

- Expired/pending/suspended/cancelled membership cannot use wholesale checkout or privileged wholesale APIs.
- Supplier A cannot read or mutate Supplier B resources.
- Wholesale buyers cannot read supplier phone, email, address, bank, identity, documents, notes, or internal fields through API, URL tampering, exports, or query responses.
- Unapproved suppliers cannot publish active listings or sell.

### Phase 3 — Shared fashion catalog

**Dependencies:** Phase 1; seller rules from Phase 2.

Deliverables:

- Product, variant, SKU/barcode, categories, brand, media metadata, and availability.
- Extensible fashion attributes without hard-coding only clothing fields.
- Seller ownership using a platform/supplier model while preserving shared catalog primitives.
- Retail visibility and Wholesale visibility rules.
- Product/variant price snapshots and history hooks.

Required tests:

- Variant uniqueness, SKU ownership, seller access, market visibility, and invalid attribute payloads.
- Supplier cannot create Retail seller listings or access platform Retail controls.

### Phase 4 — Warehouse and inventory integrity

**Status:** Partial foundation implemented.

**Dependencies:** Phase 2 supplier workflow and Phase 3 SKU model.

Deliverables:

- Warehouse, location/bin, inbound shipment, receipt, QC, damage, shortage, hold/release, transfer, count, and adjustment concepts.
- Append-oriented inventory movement ledger with actor, reason, reference, timestamp, and metadata.
- Explicit on-hand/reserved/unavailable/available/incoming quantities based on confirmed domain rules.
- Transactional reservation/release and idempotent commands.
- Central warehouse workflow for supplier inventory before wholesale fulfillment.
- Simple role-specific warehouse UI after APIs are proven.

Implemented in the current foundation: warehouses/locations, balance projections, movement and reservation persistence, source-owner database triggers, receive/reserve/release services, and the authorized warehouse receipt endpoint. Remaining concepts must not be approximated by direct balance updates.

Required tests:

- Receive, QC pass/fail, shortage, damage, return, transfer, adjustment, reserve, release, and ship movements.
- Concurrent reservations cannot oversell.
- Repeated reserve/release/ship commands do not duplicate movements.
- Supplier cannot bypass central warehouse workflow.

### Phase 5 — Commerce and order state machines

**Status:** Order snapshot/state-machine foundation started; checkout, pricing, reservation, and payment remain intentionally unimplemented.

**Dependencies:** Phase 3 catalog, Phase 4 inventory, Phase 1 identity/membership.

Deliverables:

- Shared cart and checkout primitives with Retail/Wholesale policy branches.
- Retail and Wholesale order state machines with explicit allowed transitions and history.
- Order-item snapshots for product, variant, seller, quantity, price, discount, tax/shipping inputs, and currency.
- Payment-provider abstraction, payment intent/state, authenticated/idempotent callback handling.
- Checkout idempotency keys and failure/recovery behavior.
- Retail and Wholesale customer/order interfaces.

Required tests:

- Retail checkout, valid Wholesale checkout, invalid membership checkout, MOQ/pack-size rules, stock race, duplicate callback, and failed payment recovery.
- No double charge, reservation, order creation, or shipment command.

### Phase 6 — Finance, refunds, wallet, and settlement

**Dependencies:** Phase 5 paid/fulfilled order events and Phase 4 inventory/returns hooks.

Deliverables:

- Integer minor-unit or safe Decimal money representation with explicit currency.
- Payment transaction, refund, invoice/history, commission, adjustment, receivable/payable references.
- Supplier wallet ledger with pending, held, available, and withdrawn concepts as confirmed by policy.
- Settlement calculation: gross sale minus commission, adjustments, returns, and refunds.
- Withdrawal request/review/payment/failure workflow with transactional balance reservation.
- Financial audit trail linking transaction → order → payment/refund → settlement → withdrawal.

Required tests:

- Repeated payment callback, partial/full refund, refund failure/retry, return after settlement, settlement calculation, wallet concurrency, insufficient available balance, and failed withdrawal.
- Financial records are append-only or have explicit reversal/adjustment records; no silent balance edits.

### Phase 7 — Pricing, discounts, coupons, and festivals

**Status:** Versioned base pricing foundation started; discounts, tax, shipping, promotions, and checkout integration remain unimplemented.

**Dependencies:** Phase 3 catalog, Phase 5 order snapshots, Phase 1 customer/membership context.

Deliverables:

- Retail, Wholesale, tiered, sale, promotional, supplier/platform price types.
- Manual product/variant discounts with start, end, reason, priority, and status.
- Coupon and automatic discount rules with bounded scope.
- Festival campaigns with explicit priority, stacking, best-discount, minimum cart, date, quantity, usage, and segment rules.
- A deterministic pricing result stored in the order snapshot.

Required tests:

- Date/time boundaries, expiry, minimum cart, wrong category/customer, stack conflicts, priority, maximum usage, and per-user limits.
- Pricing cannot be changed retroactively by editing a live rule.

### Phase 8 — Shipping, returns, refunds, and support operations

**Dependencies:** Phase 5 orders, Phase 6 payments/refunds, Phase 4 inventory.

Deliverables:

- Shipping method/rate, package, shipment, tracking event, and provider mapping.
- Domain shipment lifecycle separate from provider statuses.
- Return request, evidence, approval, receipt, inspection, resolution, and inventory/finance/settlement effects.
- Refund entity separate from return entity, supporting partial refunds.
- Customer, Wholesale Buyer, and Supplier ticketing with role-scoped messages and attachments.
- Admin operational queues for payment, warehouse, shipment, return, supplier, and withdrawal exceptions.

Required tests:

- Provider timeout/retry, incorrect provider status mapping, unauthorized ticket/attachment access, return quantity limits, inspection result, and partial refund.

### Phase 9 — CRM, segments, SMS, and automation

**Dependencies:** Phase 1 customers, Phase 5 orders, Phase 7 coupons/promotions.

Deliverables:

- Customer profile, tags, notes, activities, purchase history, LTV definition, and engagement events.
- Named, testable segments such as new, repeat, high-value, inactive, Wholesale, Retail, VIP, birthday, and high-return-rate.
- SMS provider interface and delivery status tracking.
- Background jobs for SMS/email/abandoned-cart/low-stock/operational notifications where infrastructure supports them.
- Automation failures are observable; core eligibility, coupons, orders, and finance remain database-backed.

Required tests:

- Segment eligibility, duplicate campaign suppression, provider outage, safe retry, unsubscribe/consent policy, and coupon-use attribution.

### Phase 10 — Retail intelligence

**Dependencies:** Phase 3 catalog, Phase 5 retail customer/session model, Phase 0 storage/security conventions.

Deliverables:

- Style Builder using the real catalog, style session, saved style, and compatibility rules.
- Try-On provider abstraction, authenticated upload/job lifecycle, quota/rate limit, safe storage, signed access, retention/deletion, and failure/retry limits.
- Optional feature flags for Try-On or expensive capabilities.

Required tests:

- Incompatible outfit rules, ownership of saved styles, upload MIME/content/size/dimension validation, unauthorized result access, provider outage, expiry, cancellation, and quota enforcement.

### Phase 11 — Blog/CMS and SEO

**Dependencies:** Phase 0 UI/runtime and Phase 3 catalog relations.

Deliverables:

- Post, category, tag, author, publish state/date, SEO metadata, and related products.
- Admin editor with preview and permission checks.
- Metadata, canonical URLs, robots, sitemap, OpenGraph, Product/Breadcrumb/Blog structured data, pagination, redirects, 404, and image performance.

Required tests:

- Draft visibility, author permissions, canonical/redirect behavior, and safe rich-content rendering.

### Phase 12 — Reports, observability, and operations

**Dependencies:** all source domains needed by each report.

Deliverables:

- Metric definitions for gross sales, net sales, refunds, discount cost, payables, commission, withdrawals, outstanding balance, AOV, conversion, repeat purchase, coupon/festival performance, inventory, returns, and campaigns.
- Actionable admin dashboard, not decorative charts.
- Structured logs, correlation IDs, error tracking, metrics, health checks, and PII/secret redaction.
- Query/index review and bounded pagination before considering a read model.

Required tests:

- Metric fixtures with boundary dates, refunds, discounts, returns, and settlements.
- Reports cannot expose private supplier fields to unauthorized roles.

### Phase 13 — Production hardening and release

**Dependencies:** all release-critical features and the relevant E2E flows.

Deliverables:

- Browser E2E for Retail, Wholesale, Supplier, Admin, privacy, failure, and recovery scenarios.
- Security review for IDOR, XSS, CSRF, SSRF, injection, mass assignment, path traversal, uploads, webhooks, rate limits, secret/log exposure, and dependency risk.
- Load/concurrency tests for inventory, coupon usage, callbacks, wallet withdrawal, and relevant list/report endpoints.
- Staging and production configuration, secret management, security headers, backup/retention, verified restore procedure, rollback, and incident runbook.
- Accessibility review for keyboard navigation, focus, labels, contrast, semantic markup, and errors.

Release gate:

```text
lint
+ typecheck
+ unit tests
+ integration tests
+ build
+ relevant Playwright E2E
+ relevant security checks
+ backup restore verification
```

## 3. Initial batch proposal

The first code batch after this audit should be limited to:

1. Runtime/dependency/tooling selection and documentation.
2. Database and migration skeleton.
3. Environment contract and secret-safe configuration.
4. Health/readiness endpoint.
5. Shared validation/error/correlation conventions.
6. CI quality gates.
7. ADRs for confirmed runtime/database choices.

Do not add product, checkout, payment, or dashboard mock flows in the initial batch. They would create a false sense of completion without identity, inventory, finance, or authorization foundations.

## 4. Workstream ownership for future parallel work

Parallel work is safe only after shared contracts are merged:

| Workstream | Owns | Must not independently change |
|---|---|---|
| Platform core | runtime, DB, shared errors, auth context, migrations | domain policy without an ADR/contract review |
| Identity/policy | auth, RBAC, supplier privacy, membership eligibility | catalog/finance schema conventions |
| Catalog | product/variant/attribute/media/seller projections | inventory quantities or order pricing |
| Warehouse | receipt/QC/inventory ledger/reservation | payment/wallet balances |
| Commerce | cart/order/checkout/payment adapter | supplier private data projection |
| Finance | payment/refund/settlement/wallet/withdrawal | inventory movement semantics |
| Frontend/UX | Retail/Admin/Supplier interfaces and design system | server authorization or business truth |
| QA/security | fixtures, integration/E2E, threat checks, release gates | silently changing domain behavior |

No two workstreams should edit the same migration or shared type in incompatible ways.
