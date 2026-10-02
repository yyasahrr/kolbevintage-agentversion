import { NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security-headers";

export function proxy(): Response {
  const response = NextResponse.next();
  applySecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
