-- Catalog permissions are added in a new migration so applied migrations remain immutable.

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000111', 'catalog:manage', 'Create and update permitted catalog products'),
  ('00000000-0000-0000-0000-000000000112', 'catalog:publish', 'Publish or archive permitted catalog products'),
  ('00000000-0000-0000-0000-000000000113', 'supplier:products:manage', 'Manage owned supplier wholesale products')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('admin', 'super_admin')
  AND permission.key IN ('catalog:manage', 'catalog:publish')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'supplier'
  AND permission.key = 'supplier:products:manage'
ON CONFLICT DO NOTHING;
