import { describe, expect, it } from "vitest";
import {
  featureSimilarity,
  featureTokens,
  matchFeature,
  normalizedTextHash,
  normalizedTitle,
  normalizeTokens,
  overlapCoefficient,
} from "@/server/ai/text-normalize";

const set = (...tokens: string[]) => new Set(tokens);

describe("normalizeTokens / featureTokens (design 7.3 worked examples)", () => {
  it("'works offline' and 'Works fully offline' both reduce to {local}", () => {
    expect(featureTokens("works offline")).toEqual(set("local"));
    expect(featureTokens("Works fully offline")).toEqual(set("local"));
    expect(featureSimilarity("works offline", "Works fully offline").overlap).toBe(1);
  });

  it("'supports local models' vs 'Runs local models (e.g. via Ollama)'", () => {
    expect(featureTokens("supports local models")).toEqual(set("local", "model"));
    // `e.g.` splits into `e` and `g`, both dropped by the 2-character rule.
    expect(featureTokens("Runs local models (e.g. via Ollama)")).toEqual(set("local", "model", "ollama"));
    expect(featureSimilarity("supports local models", "Runs local models (e.g. via Ollama)").overlap).toBe(1);
  });

  it("'doesn't upload private code' vs 'Never uploads private code' (negation canonicalization)", () => {
    expect(featureTokens("doesn't upload private code")).toEqual(set("no", "upload", "privacy", "code"));
    expect(featureTokens("doesn’t upload private code")).toEqual(set("no", "upload", "privacy", "code"));
    expect(featureTokens("Never uploads private code")).toEqual(set("no", "upload", "privacy", "code"));
    expect(featureSimilarity("doesn't upload private code", "Never uploads private code").overlap).toBe(1);
  });

  it("canonicalizes every negation form to `no`", () => {
    for (const word of ["not", "never", "no", "without", "doesn't", "don't", "isn't", "won't"]) {
      expect(normalizeTokens(`${word} upload`)).toEqual(["no", "upload"]);
    }
  });

  it("drops tokens shorter than 2 characters, e.g. the 8 in '8 GB'", () => {
    expect(normalizeTokens("Works on 8 GB RAM laptops")).toEqual(["work", "gb", "ram", "device"]);
  });

  it("keeps duplicates and order for the hash embedding", () => {
    expect(normalizeTokens("offline offline code")).toEqual(["local", "local", "code"]);
  });
});

describe("featureSimilarity non-matches and the single-token guard", () => {
  it("'works offline' does not match 'Real-time collaboration'", () => {
    expect(featureSimilarity("works offline", "Real-time collaboration").match).toBe(false);
  });

  it("'works offline' ({local}) gets no overlap match with 'Local-first storage' ({local, first, storage})", () => {
    expect(featureTokens("Local-first storage")).toEqual(set("local", "first", "storage"));
    expect(overlapCoefficient(featureTokens("works offline"), featureTokens("Local-first storage"))).toBe(0);
    expect(featureSimilarity("works offline", "Local-first storage").match).toBe(false);
  });

  it("single tokens match only when both sides are the same single token", () => {
    expect(overlapCoefficient(set("local"), set("local"))).toBe(1);
    expect(overlapCoefficient(set("local"), set("cloud"))).toBe(0);
    expect(overlapCoefficient(set(), set("local"))).toBe(0);
  });
});

describe("matchFeature", () => {
  const features = [
    { id: "f1", title: "Works fully offline", status: "active", createdAt: "2026-01-01T00:00:00Z" },
    { id: "f2", title: "Runs local models (e.g. via Ollama)", status: "active", createdAt: "2026-01-02T00:00:00Z" },
    { id: "f3", title: "Never uploads private code", status: "active", createdAt: "2026-01-03T00:00:00Z" },
    { id: "f4", title: "Costs under $20", status: "active", createdAt: "2026-01-04T00:00:00Z" },
    { id: "f5", title: "Works offline everywhere", status: "deprecated", createdAt: "2025-01-01T00:00:00Z" },
  ];

  it("maps each scene-1 capability to its seeded feature", () => {
    expect(matchFeature("works offline", features)?.id).toBe("f1");
    expect(matchFeature("supports local models", features)?.id).toBe("f2");
    expect(matchFeature("doesn't upload private code", features)?.id).toBe("f3");
  });

  it("ignores deprecated features and returns null when nothing matches", () => {
    expect(matchFeature("real-time pair programming", features)).toBeNull();
  });
});

describe("normalized titles and text hashes", () => {
  it("normalized_title is the sorted unique feature tokens and is stable across wording order", () => {
    expect(normalizedTitle("Never uploads private code")).toBe("code no privacy upload");
    expect(normalizedTitle("private code never uploads")).toBe("code no privacy upload");
    expect(normalizedTitle("Works fully offline")).toBe("local");
  });

  it("falls back to the lowercased title when no tokens remain", () => {
    expect(normalizedTitle("  It Works  ")).toBe("it works");
  });

  it("normalized_text_hash ignores case, punctuation and whitespace", () => {
    expect(normalizedTextHash("Offline,  AI coding!")).toBe(normalizedTextHash("offline ai CODING"));
    expect(normalizedTextHash("offline ai coding")).not.toBe(normalizedTextHash("online ai coding"));
  });
});
