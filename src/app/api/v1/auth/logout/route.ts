import { jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import {
  buildClearedSessionCookie,
  getSessionToken,
} from "@/server/identity/session-cookie";
import { revokeSessionToken } from "@/server/identity/session-repository";
import { isDatabaseUnavailable } from "@/server/identity/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const token = getSessionToken(request);

  try {
    if (token) {
      await revokeSessionToken(token);
    }

    return jsonNoStore({ ok: true }, requestId, 200, {
      "set-cookie": buildClearedSessionCookie(),
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonNoStore({ ok: false }, requestId, 503, {
        "set-cookie": buildClearedSessionCookie(),
      });
    }

    return jsonNoStore({ ok: false }, requestId, 500, {
      "set-cookie": buildClearedSessionCookie(),
    });
  }
}
