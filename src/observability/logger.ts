/**
 * STRUCTURED LOGGER
 * ─────────────────────────────────────────────────────────────────────────────
 * Emits JSON lines to stdout. Each line is a self-contained event record.
 * In production, pipe stdout to a log aggregator (Datadog, Loki, CloudWatch).
 *
 * Layer: Infrastructure
 *
 * Environment variables:
 *   LOG_LEVEL  — "debug" | "info" | "warn" | "error"  (default: "info")
 *   LOG_FORMAT — "json" | "pretty"                    (default: "json")
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
const prettyFormat = process.env.LOG_FORMAT === "pretty";

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[configuredLevel]) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  if (prettyFormat) {
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    const colour = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : level === "debug" ? "\x1b[90m" : "\x1b[36m";
    console.log(`${colour}[${level.toUpperCase()}]\x1b[0m ${message}${metaStr}`);
  } else {
    process.stdout.write(JSON.stringify(record) + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    emit("error", message, meta),
};
