/**
 * Calibration corpus (design 7.5): the 12 seed clusters with their synthetic requests, plus labelled probes.
 * `matchLocal` runs the local-space pipeline end to end in memory with the same retrieval rule as the RPCs
 * (top 8 clusters by centroid ∪ clusters of the top 20 member requests).
 */
import { SEED_CLUSTERS } from "../../scripts/seed-data/clusters";
import { assembleCandidates, runMatcher, type Classifier, type MatcherCluster } from "@/server/ai/agents/demand-matcher";
import { centroid, cosine, hashEmbed } from "@/server/ai/hash-embedding";
import { interpretHeuristically } from "@/server/ai/heuristics/intent-heuristics";
import { CANDIDATE_LIMITS, DEFAULT_THRESHOLDS, type SpaceThresholds } from "@/server/config/matching";

export const SCENE_1_TEXT =
  "I want an AI coding assistant that works offline, supports local models, doesn't upload private code, and costs less than $20.";
export const CLOUD_IDE_PROBE = "cloud-only collaborative IDE for teams with real-time pair programming in the browser";

export type Probe = { text: string; cluster: string; expect: "join" | "not_join" };

/** Positive probes must reach `join` for their cluster; negative probes must stay below `join` for it. */
export const PROBES: Probe[] = [
  // Offline AI coding assistant
  { cluster: "offline-coding", expect: "join", text: SCENE_1_TEXT },
  { cluster: "offline-coding", expect: "join", text: "I want an offline alternative to Cursor that runs local models on my laptop." },
  { cluster: "offline-coding", expect: "join", text: "I need local AI coding help without sending code to the cloud." },
  { cluster: "offline-coding", expect: "join", text: "Looking for an IDE assistant that works privately on my laptop and never uploads my code." },
  { cluster: "offline-coding", expect: "not_join", text: CLOUD_IDE_PROBE },
  { cluster: "offline-coding", expect: "not_join", text: "I want a tool that keeps our README and API docs up to date whenever the code changes." },
  { cluster: "offline-coding", expect: "not_join", text: "I need a cloud-only SaaS code review dashboard for my whole team." },
  // Privacy-first personal knowledge search
  { cluster: "knowledge-search", expect: "join", text: "I want to search my notes and PDFs with natural-language questions without uploading them." },
  { cluster: "knowledge-search", expect: "join", text: "I need a private local search engine for my Markdown notes and documents." },
  { cluster: "knowledge-search", expect: "join", text: "Looking for semantic search over my personal files that runs locally and keeps my data private." },
  { cluster: "knowledge-search", expect: "not_join", text: "I want meeting notes that are transcribed on my laptop with action items." },
  { cluster: "knowledge-search", expect: "not_join", text: "I need a spreadsheet that cleans duplicate rows automatically." },
  // Lightweight self-hosted analytics
  { cluster: "self-hosted-analytics", expect: "join", text: "I want cookie-free website analytics that I can self-host on a small server." },
  { cluster: "self-hosted-analytics", expect: "join", text: "I need an open-source Google Analytics alternative with a simple dashboard of visitors." },
  { cluster: "self-hosted-analytics", expect: "join", text: "Looking for lightweight self-hosted traffic analytics for my blog without personal data." },
  { cluster: "self-hosted-analytics", expect: "not_join", text: "I want a hosted analytics platform with session recordings and heatmaps for marketing teams." },
  { cluster: "self-hosted-analytics", expect: "not_join", text: "I need weekly sales reports built from spreadsheets automatically." },
  // Privacy-preserving meeting notes
  { cluster: "meeting-notes", expect: "join", text: "I want meeting transcription that runs on my device so the audio never leaves my machine." },
  { cluster: "meeting-notes", expect: "join", text: "I need private summaries with action items for Zoom calls without uploading the recordings." },
  { cluster: "meeting-notes", expect: "join", text: "Looking for an offline note taker for confidential client calls with speaker labels." },
  { cluster: "meeting-notes", expect: "not_join", text: "I want a cloud-only meeting recorder that shares recordings with my whole company." },
  { cluster: "meeting-notes", expect: "not_join", text: "I need a local search engine for my research papers and PDFs." },
  // Local-first collaborative whiteboard
  { cluster: "whiteboard", expect: "join", text: "I want a whiteboard with sticky notes that works offline and syncs with my team later." },
  { cluster: "whiteboard", expect: "join", text: "I need a local-first infinite canvas for real-time brainstorming with my team." },
  { cluster: "whiteboard", expect: "join", text: "Looking for a Miro alternative where boards are stored on my device." },
  { cluster: "whiteboard", expect: "not_join", text: "I want a cloud-only whiteboard SaaS with real-time collaboration for enterprises." },
  { cluster: "whiteboard", expect: "not_join", text: "I need Figma designs turned into accessible HTML code." },
];

export type CorpusCluster = MatcherCluster & { key: string; centroid: number[]; requestVectors: { id: string; vector: number[] }[] };

let cache: CorpusCluster[] | null = null;

/** Seed clusters as the matcher sees them after seeding: active features, tags, centroid of linked request vectors. */
export function corpusClusters(): CorpusCluster[] {
  if (cache) return cache;
  cache = SEED_CLUSTERS.map((fixture) => {
    const features = [
      ...fixture.required.map((f) => ({ ...f, kind: "required" })),
      ...fixture.niceToHave.map((f) => ({ ...f, kind: "nice_to_have" })),
      ...(fixture.emerged ? [{ ...fixture.emerged, kind: "nice_to_have" }] : []),
    ].map((f, i) => ({
      id: `${fixture.key}:f${i}`,
      title: f.title,
      status: "active",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    const requestVectors = fixture.requests.map((r, i) => ({ id: `${fixture.key}:r${i}`, vector: hashEmbed(r.text) }));
    return {
      key: fixture.key,
      id: fixture.key,
      slug: fixture.slug,
      title: fixture.title,
      description: fixture.description,
      category: fixture.category,
      tags: fixture.tags,
      features,
      centroid: centroid(requestVectors.map((r) => r.vector))!,
      requestVectors,
    };
  });
  return cache;
}

export function clusterByKey(key: string): CorpusCluster {
  const found = corpusClusters().find((c) => c.key === key);
  if (!found) throw new Error(`unknown corpus cluster ${key}`);
  return found;
}

/** Full local-space pipeline for one text; returns every candidate (no top-3 cut) so tests can inspect any cluster. */
export async function matchLocal(text: string, options: { thresholds?: SpaceThresholds; classifier?: Classifier | null } = {}) {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS.local;
  const query = hashEmbed(text);
  const clusters = corpusClusters();
  const clusterHits = clusters
    .map((c) => ({ clusterId: c.id, similarity: cosine(query, c.centroid) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CANDIDATE_LIMITS.clusters);
  const requestHits = clusters
    .flatMap((c) => c.requestVectors.map((r) => ({ clusterId: c.id, similarity: cosine(query, r.vector) })))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CANDIDATE_LIMITS.requests);
  const sims = assembleCandidates(clusterHits, requestHits);
  const intent = interpretHeuristically({ rawText: text });
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const result = await runMatcher({
    request: { intent, rawText: text },
    candidates: [...sims.entries()].map(([id, s]) => ({ cluster: byId.get(id)!, sims: s })),
    space: "local",
    thresholds,
    classifier: options.classifier ?? null,
    limit: clusters.length,
  });
  return { ...result, intent };
}
