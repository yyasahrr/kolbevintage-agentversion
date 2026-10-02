import { query } from "@/server/db/pool";

export async function userHasPermission(userId: string, permissionKey: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
     FROM user_roles user_role
     INNER JOIN role_permissions role_permission ON role_permission.role_id = user_role.role_id
     INNER JOIN permissions permission ON permission.id = role_permission.permission_id
     WHERE user_role.user_id = $1
       AND permission.key = $2
     LIMIT 1`,
    [userId, permissionKey],
  );

  return result.rowCount === 1;
}
