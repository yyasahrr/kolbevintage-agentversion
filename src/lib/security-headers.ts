export function getSecurityHeaders(nodeEnv = process.env.NODE_ENV): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "cross-origin-opener-policy": "same-origin",
    ...(nodeEnv === "production"
      ? { "strict-transport-security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

export function applySecurityHeaders(headers: Headers, nodeEnv = process.env.NODE_ENV): Headers {
  for (const [name, value] of Object.entries(getSecurityHeaders(nodeEnv))) {
    headers.set(name, value);
  }
  return headers;
}
