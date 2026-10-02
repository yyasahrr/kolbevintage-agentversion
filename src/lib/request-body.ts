export const maxJsonBodyBytes = 64 * 1024;

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("The request body must contain valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("The request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxJsonBodyBytes) {
    throw new RequestBodyTooLargeError();
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxJsonBodyBytes) {
    throw new RequestBodyTooLargeError();
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
