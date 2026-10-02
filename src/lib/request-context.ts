const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestIdHeader = "x-request-id";

export function getRequestId(request: Request): string {
  const suppliedRequestId = request.headers.get(requestIdHeader)?.trim();

  if (suppliedRequestId && requestIdPattern.test(suppliedRequestId)) {
    return suppliedRequestId;
  }

  return crypto.randomUUID();
}
