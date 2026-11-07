import { describe, expect, it } from "vitest";
import { createEmbedder } from "@/server/ai/embeddings";
import { cosine, fnv1a, hashEmbed, localEmbeddingVersion, parseVector, toVectorLiteral } from "@/server/ai/hash-embedding";
import { createFakeFetch } from "../fakes/fetch";
import { createFakeRunStore } from "../fakes/run-store";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe("hashEmbed", () => {
  it("is deterministic", () => {
    expect(hashEmbed("I want an offline coding assistant")).toEqual(hashEmbed("I want an offline coding assistant"));
    expect(fnv1a("a")).toBe(0xe40c292c);
  });

  it("is generated at D dimensions, L2-normalized and zero-padded to 1536", () => {
    const v = hashEmbed("local models on my laptop", 256);
    expect(v).toHaveLength(1536);
    expect(v.slice(256).every((x) => x === 0)).toBe(true);
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 10);
    expect(localEmbeddingVersion(256)).toBe("hash-v1-d256");
  });

  it("rejects dimensions outside 16..1536", () => {
    expect(() => hashEmbed("x", 8)).toThrow(RangeError);
    expect(() => hashEmbed("x", 2048)).toThrow(RangeError);
  });

  it("scores paraphrases above unrelated texts", () => {
    const a = hashEmbed("An AI coding assistant that works offline with local models");
    const paraphrase = hashEmbed("Offline AI code assistant running local models on my laptop");
    const unrelated = hashEmbed("Collaborative whiteboard for designers with sticky notes");
    expect(cosine(a, paraphrase)).toBeGreaterThan(cosine(a, unrelated) + 0.2);
  });

  it("round-trips through the pgvector text format", () => {
    const v = hashEmbed("round trip", 16);
    expect(parseVector(toVectorLiteral(v))).toEqual(v);
    expect(parseVector(null)).toBeNull();
  });
});

describe("embedder", () => {
  it("embeds raw_text only: the local vector depends on nothing but the text", async () => {
    const embedder = createEmbedder({
      config: { mode: "local-only", baseUrl: "https://x", dimensions: 1536, sendDimensions: true, timeoutMs: 1000 },
      fetchImpl: createFakeFetch().fetchImpl,
      runs: createFakeRunStore().store,
      logger,
    });
    const text = "I want an AI coding assistant that works offline";
    const embedded = await embedder.embed(text);
    expect(embedded.model).toBeNull();
    expect(embedded.local).toEqual(hashEmbed(text));
    expect(embedded.localVersion).toBe("hash-v1-d1536");
  });

  it("pads model embeddings to 1536 and treats a wrong length as a failure with a failed run", async () => {
    const vector = Array.from({ length: 512 }, (_, i) => (i % 7) / 7);
    const fake = createFakeFetch([
      { status: 200, json: { data: [{ embedding: vector }] } },
      { status: 200, json: { data: [{ embedding: vector.slice(0, 100) }] } },
      { status: 500, json: {} },
    ]);
    const runs = createFakeRunStore();
    const embedder = createEmbedder({
      config: { mode: "model", baseUrl: "https://emb.test/v1", apiKey: "k", model: "text-embedding-3-small", dimensions: 512, sendDimensions: true, timeoutMs: 1000 },
      fetchImpl: fake.fetchImpl,
      runs: runs.store,
      logger,
    });
    const ok = await embedder.embedModel("hello world");
    expect(ok).toHaveLength(1536);
    expect(ok?.slice(0, 512)).toEqual(vector);
    expect(fake.calls[0].body).toEqual({ model: "text-embedding-3-small", input: "hello world", dimensions: 512 });
    expect(await embedder.embedModel("wrong length")).toBeNull();
    expect(await embedder.embedModel("server error")).toBeNull();
    expect(runs.rows.map((r) => r.status)).toEqual(["failed", "failed"]);
  });
});
