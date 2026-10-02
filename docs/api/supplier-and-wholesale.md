# Supplier and Wholesale API

**Status:** Foundation partial. These APIs establish server-authoritative supplier onboarding, privacy projection, and wholesale eligibility. They do not create listings, inventory, orders, payments, or settlements.

## Supplier application lifecycle

```text
draft
  ↓ submit
submitted
  ↓ review
under_review
  ├── changes_requested → submitted
  ├── approved → supplier account + supplier role
  └── rejected
approved → suspended → approved
approved → disabled
```

Invalid transitions are rejected by the domain state machine and by the database-backed service transaction.

## Applicant endpoints

All applicant endpoints require an active authenticated session. They are owner-scoped; a user cannot load or submit another user's application ID.

### `GET /api/v1/supplier/applications`

Returns the authenticated user's applications, capped at 20 records.

### `POST /api/v1/supplier/applications`

Creates a draft application.

```json
{
  "publicDisplayName": "Studio A",
  "publicBrandName": "Brand A",
  "publicBio": "A public buyer-facing description.",
  "legalName": "Studio A LLC",
  "contactEmail": "owner@example.com",
  "contactPhone": "+1 555 0100",
  "businessAddress": "Private business address"
}
```

Private application fields are stored in the application/private profile tables and are never used by the buyer-facing public projection.

### `GET /api/v1/supplier/applications/:applicationId`

Returns an application only to its applicant.

### `POST /api/v1/supplier/applications/:applicationId/submit`

Moves an owned `draft` or `changes_requested` application to `submitted`. The operation is transactional and records an application event and audit record.

## Admin review endpoints

These endpoints require the `supplier:review` permission. Role membership is checked server-side; hiding an Admin button in the UI is not an authorization control.

### `GET /api/v1/admin/supplier-applications?status=under_review&limit=50`

Returns a bounded review list. The Admin review projection may include private application fields because it is a privileged operational surface.

### `POST /api/v1/admin/supplier-applications/:applicationId/decision`

Request:

```json
{
  "status": "approved",
  "reason": null
}
```

`reason` is required for `changes_requested`, `rejected`, `suspended`, and `disabled` decisions. Approval transactionally:

1. validates the state transition;
2. updates the application and appends a transition event;
3. writes an audit record;
4. creates or updates the Supplier account;
5. creates/updates the private supplier profile;
6. assigns the supplier system role.

## Wholesale eligibility

### `GET /api/v1/wholesale/eligibility`

Returns the current server-evaluated entitlement. A user is eligible only when:

```text
wholesale account status = active
membership status = active
starts_at <= now
ends_at > now
```

The frontend cannot mark a membership active or bypass this check.

### `GET /api/v1/wholesale/suppliers/:supplierId`

Requires an active Wholesale membership. The query selects only:

```json
{
  "supplier": {
    "id": "...",
    "displayName": "Studio A",
    "brandName": "Brand A",
    "bio": "Public description",
    "status": "approved"
  }
}
```

The query does not fetch `supplier_private_profiles`. Buyer responses do not contain phone, email, legal name, business address, internal notes, bank information, or document storage keys.

## Known limitations before production

- Supplier documents need a secured object-storage adapter, MIME/content/size validation, signed access, retention, and deletion policy.
- Wholesale plan creation, membership purchase, payment, renewal, suspension, and admin assignment UI are not implemented.
- Supplier/Admin portal UI is not implemented.
- Full IDOR/security tests for exports, reports, documents, and future listing/order APIs are still required.
- Auth rate limiting and account-abuse controls remain a prerequisite before public launch.
