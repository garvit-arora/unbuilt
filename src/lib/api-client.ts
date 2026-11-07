/**
 * Browser helper for the JSON Route Handlers (design 6.3). Always sends `Content-Type: application/json`
 * (the CSRF guard requires it, also for empty POSTs) and turns the error envelope into an `ApiError`.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function api<T>(path: string, options: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: method === "GET" ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach UNBUILT. Check your connection and try again.");
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const envelope = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(response.status, envelope?.code ?? "HTTP_ERROR", envelope?.message ?? `Request failed (${response.status}).`, envelope?.details);
  }
  return data as T;
}

/** First field error from a VALIDATION_ERROR `details` (z.flattenError shape), for inline messages. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") return {};
  const details = error.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined;
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(details?.fieldErrors ?? {})) if (messages?.[0]) out[key] = messages[0];
  return out;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = Object.entries(fieldErrors(error));
    return fields.length ? `${error.message} ${fields.map(([k, v]) => `${k}: ${v}`).join("; ")}` : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}
