# Dependency-Aware Implementation Plan

**Status:** Discovery complete; implementation not started
**Source:** `docs/audit/repository-audit.md` and the project business invariants
**Principle:** Smallest correct change, shared core, server-authoritative business rules.

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

**Dependencies:** Phase 2 supplier workflow and Phase 3 SKU model.

Deliverables:

- Warehouse, location/bin, inbound shipment, receipt, QC, damage, shortage, hold/release, transfer, count, and adjustment concepts.
- Append-oriented inventory movement ledger with actor, reason, reference, timestamp, and metadata.
- Explicit on-hand/reserved/unavailable/available/incoming quantities based on confirmed domain rules.
- Transactional reservation/release and idempotent commands.
- Central warehouse workflow for supplier inventory before wholesale fulfillment.
- Simple role-specific warehouse UI after APIs are proven.

Required tests:

- Receive, QC pass/fail, shortage, damage, return, transfer, adjustment, reserve, release, and ship movements.
- Concurrent reservations cannot oversell.
- Repeated reserve/release/ship commands do not duplicate movements.
- Supplier cannot bypass central warehouse workflow.

### Phase 5 — Commerce and order state machines

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
