import { requestIdHeader } from "@/lib/request-context";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "NOT_READY";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

export function jsonError(
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
    },
  };

  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      [requestIdHeader]: requestId,
    },
  });
}

export function jsonNoStore<T>(
  body: T,
  requestId: string,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      [requestIdHeader]: requestId,
      ...extraHeaders,
    },
  });
}
