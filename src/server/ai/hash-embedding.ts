import "server-only";
import { normalizeTokens } from "./text-normalize";

/**
 * Local hash embedding `hash-v1-d<D>` (design 7.3): unigrams (1.0) + adjacent bigrams (0.7) + character trigrams of
 * each token (0.3), FNV-1a 32-bit hashed to index `h % D` with sign from the top bit, L2-normalized, zero-padded to
 * 1536. Deterministic and dependency-free; always computed from `raw_text` only.
 */

export const STORED_DIMENSIONS = 1536;

export function localEmbeddingVersion(dimensions: number): string {
  return `hash-v1-d${dimensions}`;
}

/** FNV-1a 32-bit over the UTF-8 bytes. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function add(vector: Float64Array, feature: string, weight: number) {
  const h = fnv1a(feature);
  const sign = h >>> 31 ? -1 : 1;
  vector[h % vector.length] += sign * weight;
}

/** Right-pads with zeros to 1536 (cosine-preserving). */
export function padVector(values: ArrayLike<number>, length = STORED_DIMENSIONS): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < Math.min(values.length, length); i += 1) out[i] = values[i];
  return out;
}

export function hashEmbed(text: string, dimensions: number = STORED_DIMENSIONS): number[] {
  if (!Number.isInteger(dimensions) || dimensions < 16 || dimensions > STORED_DIMENSIONS) {
    throw new RangeError(`dimensions must be an integer in 16..${STORED_DIMENSIONS}, got ${dimensions}`);
  }
  const tokens = normalizeTokens(text);
  const vector = new Float64Array(dimensions);
  tokens.forEach((token, i) => {
    add(vector, `u:${token}`, 1.0);
    if (i + 1 < tokens.length) add(vector, `b:${token} ${tokens[i + 1]}`, 0.7);
    for (let c = 0; c + 3 <= token.length; c += 1) add(vector, `c:${token.slice(c, c + 3)}`, 0.3);
  });
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  return padVector(vector);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Element-wise mean (what `avg(vector)` does in Postgres for cluster centroids). */
export function centroid(vectors: readonly (readonly number[])[]): number[] | null {
  if (vectors.length === 0) return null;
  const out = new Array<number>(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i += 1) out[i] += v[i];
  return out.map((x) => x / vectors.length);
}

/** pgvector text literal. */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/** Parses pgvector's text output ("[0.1,0.2,...]"). */
export function parseVector(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .filter((part) => part !== "")
    .map(Number);
}
