import { getEnvironment } from "@/lib/env";

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;
type LogLevel = "debug" | "info" | "warn" | "error";

const sensitiveKeyPattern = /(password|secret|token|authorization|cookie|iban|bank|email|phone)/i;

function safeContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

function shouldLog(level: LogLevel, configuredLevel: LogLevel): boolean {
  const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[level] >= order[configuredLevel];
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const environment = getEnvironment();
  if (!shouldLog(level, environment.LOG_LEVEL)) {
    return;
  }

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: environment.APP_NAME,
    message,
    ...safeContext(context),
  });

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}
