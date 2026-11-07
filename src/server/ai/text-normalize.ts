import "server-only";
import { createHash } from "node:crypto";
import { cosine, hashEmbed } from "./hash-embedding";

/**
 * Shared text normalization (design 7.3). One tokenizer feeds the local hash embedding, feature matching
 * (`featureTokens`, `featureSimilarity`, `matchFeature`), feature dedupe (`normalizedTitle`) and the calibration test.
 */

const STOPWORDS = new Set(
  (
    "a an the i we my our me to of for in on at by is are be it this that which who want wish need would like there " +
    "were was some someone something can could please just really and or with from into so as if its than then very " +
    "much any every you your they them their us he she his her am been being do did will what when where how " +
    "about one thing things kind sort way get got make makes made let lets tool app"
  ).split(/\s+/),
);

/** Feature-level stopwords, removed on top of the general ones (design 7.3). */
const FEATURE_STOPWORDS = new Set([
  "support",
  "supports",
  "works",
  "work",
  "run",
  "runs",
  "fully",
  "allow",
  "allows",
  "has",
  "have",
  "can",
  "should",
  "able",
  "completely",
  "entirely",
  "eg",
  "via",
  "also",
]);

/** Multi-word or hyphenated phrases joined before tokenizing so the synonym map can see them. */
const PHRASES: [RegExp, string][] = [
  [/\bon[- ]device\b/g, " ondevice "],
  [/\bair[- ]gapped\b/g, " airgapped "],
  [/\blow[- ]cost\b/g, " lowcost "],
  [/\breal[- ]time\b/g, " realtime "],
  [/\bopen[- ]source\b/g, " opensource "],
  [/\bself[- ]hosted\b/g, " selfhosted "],
  [/\bcross[- ]platform\b/g, " crossplatform "],
  [/\bvs[- ]code\b|\bvisual studio code\b/g, " vscode "],
];

const SYNONYM_GROUPS: Record<string, string[]> = {
  local: ["offline", "ondevice", "airgapped", "local", "locally"],
  privacy: ["private", "privacy", "privately", "confidential"],
  cloud: ["cloud", "saas", "hosted"],
  editor: ["ide", "ides", "editor", "editors"],
  code: ["coding", "code", "programming", "developer", "developers", "source", "coder", "coders", "dev", "devs"],
  assistant: ["ai", "copilot", "assistant", "assistants"],
  model: ["llm", "llms", "model", "models"],
  cheap: ["cheap", "cheaper", "affordable", "inexpensive", "lowcost"],
  subscription: ["subscription", "subscriptions", "monthly"],
  no: ["not", "never", "no", "without", "doesnt", "dont", "isnt", "wont", "cannot", "cant", "didnt", "nothing"],
  upload: ["uploads", "upload", "uploading", "uploaded", "send", "sending", "sends", "sent"],
  device: ["laptop", "laptops", "computer", "computers", "machine", "machines", "pc"],
  collaborate: ["collaborative", "collaboration", "collaborate", "multiplayer"],
  spreadsheet: ["spreadsheet", "spreadsheets", "excel", "sheets"],
  note: ["notes", "note", "notebook", "notebooks"],
  meeting: ["meeting", "meetings", "call", "calls"],
  search: ["search", "searching", "searches", "find", "lookup"],
  document: ["docs", "documentation", "document", "documents", "readme", "readmes"],
  video: ["video", "videos", "footage"],
  automation: ["automate", "automation", "automated", "automating", "automations", "workflow", "workflows"],
  accessibility: ["accessible", "accessibility", "a11y"],
  language: ["multilingual", "language", "languages"],
  tutor: ["tutor", "tutoring", "teach", "teaching", "lesson", "lessons", "learn", "learning"],
  free: ["free", "gratis"],
  opensource: ["opensource", "oss", "foss"],
  selfhosted: ["selfhosted"],
  fast: ["fast", "quick", "quickly", "speedy"],
};

const SYNONYMS = new Map<string, string>();
for (const [canonical, words] of Object.entries(SYNONYM_GROUPS)) {
  for (const word of words) SYNONYMS.set(word, canonical);
}

function synonym(token: string): string {
  return SYNONYMS.get(token) ?? token;
}

/** Light stemming: strip ing|ed|es|s when the stem keeps at least 4 characters. */
function stem(token: string): string {
  if (token.endsWith("ing") && token.length - 3 >= 4) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length - 2 >= 4) return token.slice(0, -2);
  if (/(s|x|z|ch|sh)es$/.test(token) && token.length - 2 >= 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length - 1 >= 4) return token.slice(0, -1);
  return token;
}

/** Ordered tokens (duplicates kept) after lowercasing, stopwords, synonyms and light stemming. */
export function normalizeTokens(input: string): string[] {
  let text = input.toLowerCase().replace(/[’‘`]/g, "'").replace(/'/g, "");
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  text = text.replace(/[^a-z0-9]+/g, " ");
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const token = synonym(stem(synonym(raw)));
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** `normalizeTokens` minus feature stopwords, as a set. */
export function featureTokens(input: string): Set<string> {
  const out = new Set<string>();
  for (const token of normalizeTokens(input)) if (!FEATURE_STOPWORDS.has(token)) out.add(token);
  return out;
}

/** `feature_requests.normalized_title`: sorted unique feature tokens, else the lowercased trimmed title. */
export function normalizedTitle(title: string): string {
  const tokens = [...featureTokens(title)].sort();
  return tokens.length > 0 ? tokens.join(" ") : title.trim().toLowerCase();
}

/** sha256 of the lowercased, punctuation-stripped, whitespace-collapsed text (`demand_requests.normalized_text_hash`). */
export function normalizedTextHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export const FEATURE_OVERLAP_THRESHOLD = 0.6;
export const FEATURE_COSINE_THRESHOLD = 0.55;
/** Feature matching always hashes at full width so results do not depend on EMBEDDING_DIMENSIONS. */
const FEATURE_HASH_DIMENSIONS = 1536;

/** |A∩B| / min(|A|,|B|), with the single-token guard of design 7.3. */
export function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  const min = Math.min(a.size, b.size);
  if (min === 0) return 0;
  if (min === 1) {
    if (a.size !== 1 || b.size !== 1) return 0;
    return [...a][0] === [...b][0] ? 1 : 0;
  }
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / min;
}

export type FeatureSimilarity = { match: boolean; overlap: number; cosine: number };

export function featureSimilarity(a: string, b: string): FeatureSimilarity {
  const overlap = overlapCoefficient(featureTokens(a), featureTokens(b));
  const cos = cosine(hashEmbed(a, FEATURE_HASH_DIMENSIONS), hashEmbed(b, FEATURE_HASH_DIMENSIONS));
  return { match: overlap >= FEATURE_OVERLAP_THRESHOLD || cos >= FEATURE_COSINE_THRESHOLD, overlap, cosine: cos };
}

export type MatchableFeature = { id: string; title: string; status: string; createdAt: string };

/** Feature statuses that can be matched (both are part of the requirements snapshot). */
export const MATCHABLE_FEATURE_STATUSES = new Set(["active", "emerging"]);

/**
 * Best matching active feature for a capability: highest overlap, ties by cosine, then oldest. Null when none match.
 */
export function matchFeature<F extends MatchableFeature>(capability: string, features: readonly F[]): F | null {
  let best: { feature: F; sim: FeatureSimilarity } | null = null;
  for (const feature of features) {
    if (!MATCHABLE_FEATURE_STATUSES.has(feature.status)) continue;
    const sim = featureSimilarity(capability, feature.title);
    if (!sim.match) continue;
    if (
      !best ||
      sim.overlap > best.sim.overlap ||
      (sim.overlap === best.sim.overlap && sim.cosine > best.sim.cosine) ||
      (sim.overlap === best.sim.overlap && sim.cosine === best.sim.cosine && feature.createdAt < best.feature.createdAt)
    ) {
      best = { feature, sim };
    }
  }
  return best?.feature ?? null;
}
