/** Scripted `fetch` for unit tests: responses are consumed in order and every call is recorded. */

export type FakeResponse =
  | { status: number; json?: unknown; text?: string }
  | { throws: Error };

export type RecordedCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

export function createFakeFetch(responses: FakeResponse[] = []) {
  const queue = [...responses];
  const calls: RecordedCall[] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep the raw string
      }
    }
    calls.push({ url: String(input), method: init?.method ?? "GET", headers, body });
    const next = queue.shift();
    if (!next) throw new Error(`fake fetch: no response queued for ${String(input)}`);
    if ("throws" in next) throw next.throws;
    const text = next.text ?? JSON.stringify(next.json ?? {});
    return new Response(text, { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    push: (...more: FakeResponse[]) => queue.push(...more),
    remaining: () => queue.length,
  };
}

/** An OpenAI-style chat completion response. */
export function chatCompletion(content: string, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  return { status: 200, json: { choices: [{ message: { content } }], usage } };
}
