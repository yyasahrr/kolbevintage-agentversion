-- Initial role and permission vocabulary from the project requirements.
-- These are system records; application code must not silently rename them.

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000101', 'profile:read:self', 'Read the authenticated user profile'),
  ('00000000-0000-0000-0000-000000000102', 'profile:update:self', 'Update allowed fields on the authenticated user profile'),
  ('00000000-0000-0000-0000-000000000103', 'supplier:apply', 'Submit or update an owned supplier application'),
  ('00000000-0000-0000-0000-000000000104', 'wholesale:access', 'Access wholesale capabilities when entitlement is active'),
  ('00000000-0000-0000-0000-000000000105', 'supplier:portal:access', 'Access the authenticated supplier portal'),
  ('00000000-0000-0000-0000-000000000106', 'admin:users:read', 'Read permitted user records in administration'),
  ('00000000-0000-0000-0000-000000000107', 'admin:roles:manage', 'Manage role assignments'),
  ('00000000-0000-0000-0000-000000000108', 'audit:read', 'Read permitted audit records'),
  ('00000000-0000-0000-0000-000000000109', 'supplier:review', 'Review supplier applications'),
  ('00000000-0000-0000-0000-000000000110', 'finance:operate', 'Operate permitted finance workflows')
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (id, key, display_name) VALUES
  ('00000000-0000-0000-0000-000000001001', 'customer', 'Customer'),
  ('00000000-0000-0000-0000-000000001002', 'wholesale_customer', 'Wholesale customer'),
  ('00000000-0000-0000-0000-000000001003', 'supplier', 'Supplier'),
  ('00000000-0000-0000-0000-000000001004', 'warehouse_operator', 'Warehouse operator'),
  ('00000000-0000-0000-0000-000000001005', 'support_agent', 'Support agent'),
  ('00000000-0000-0000-0000-000000001006', 'finance_operator', 'Finance operator'),
  ('00000000-0000-0000-0000-000000001007', 'marketing_operator', 'Marketing operator'),
  ('00000000-0000-0000-0000-000000001008', 'manager', 'Manager'),
  ('00000000-0000-0000-0000-000000001009', 'admin', 'Administrator'),
  ('00000000-0000-0000-0000-000000001010', 'super_admin', 'Super administrator')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'customer'
  AND permission.key IN ('profile:read:self', 'profile:update:self', 'supplier:apply')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'wholesale_customer'
  AND permission.key IN ('profile:read:self', 'profile:update:self', 'wholesale:access')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'supplier'
  AND permission.key IN ('profile:read:self', 'profile:update:self', 'supplier:portal:access')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'finance_operator'
  AND permission.key IN ('finance:operate', 'audit:read')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('admin', 'super_admin')
ON CONFLICT DO NOTHING;
