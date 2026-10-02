import { DatabaseNotConfiguredError } from "@/server/db/config";

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseNotConfiguredError) {
    return true;
  }

  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = error.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "28P01" ||
    code === "3D000" ||
    code === "3F000" ||
    code === "42P01"
  );
}
