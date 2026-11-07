import "server-only";

/**
 * JSON-lines logger (design 6.3). Redacts secret-looking keys, truncates long strings (raw wish text is never
 * logged beyond 80 characters) and drops payer emails.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACT_KEY = /secret|token|authorization|password|key/i;
const DROP_KEY = /email/i;
const MAX_STRING = 80;
const MAX_DEPTH = 5;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEY.test(key)) continue;
    out[key] = REDACT_KEY.test(key) ? "[redacted]" : redact(inner, depth + 1);
  }
  return out;
}

function write(level: LogLevel, msg: string, fields: LogFields = {}) {
  const { stack, ...rest } = fields as LogFields & { stack?: unknown };
  const line: LogFields = { level, msg, ts: new Date().toISOString(), ...(redact(rest) as LogFields) };
  // Stacks are only attached to error-level lines and are not truncated.
  if (level === "error" && typeof stack === "string") line.stack = stack;
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => {
    if (process.env.NODE_ENV !== "production") write("debug", msg, fields);
  },
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};

export type Logger = typeof logger;
