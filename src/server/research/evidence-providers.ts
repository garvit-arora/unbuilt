import "server-only";

import { env } from "@/server/config/env";

export type ResearchSource = { title: string; url: string; snippet: string };

type ElasticHit = { _source?: Partial<ResearchSource> };

function elasticHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `ApiKey ${env.research.elastic.apiKey}`,
  };
}
export async function searchElasticEvidence(query: string, fetchImpl: typeof fetch): Promise<ResearchSource[]> {
  const elastic = env.research.elastic;
  if (!elastic.configured || !elastic.url || !elastic.apiKey) return [];
  const response = await fetchImpl(`${elastic.url}/${encodeURIComponent(elastic.index)}/_search`, {
    method: "POST",
    headers: elasticHeaders(),
    body: JSON.stringify({
      size: 8,
      query: { multi_match: { query, fields: ["title^3", "snippet", "wishTitle^2"] } },
      _source: ["title", "url", "snippet"],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { hits?: { hits?: ElasticHit[] } };
  return (payload.hits?.hits ?? []).flatMap(({ _source }) =>
    typeof _source?.title === "string" && typeof _source.url === "string" && typeof _source.snippet === "string"
      ? [{ title: _source.title, url: _source.url, snippet: _source.snippet }]
      : [],
  );
}

export async function indexElasticEvidence(
  sources: ResearchSource[],
  context: { requestId: string; wishTitle: string },
  fetchImpl: typeof fetch,
) {
  const elastic = env.research.elastic;
  if (!elastic.configured || !elastic.url || !elastic.apiKey || sources.length === 0) return;
  const lines = sources.flatMap((source) => [
    JSON.stringify({ index: { _index: elastic.index } }),
    JSON.stringify({ ...source, ...context, indexedAt: new Date().toISOString() }),
  ]);
  await fetchImpl(`${elastic.url}/_bulk`, {
    method: "POST",
    headers: elasticHeaders(),
    body: `${lines.join("\n")}\n`,
    signal: AbortSignal.timeout(5_000),
  });
}

