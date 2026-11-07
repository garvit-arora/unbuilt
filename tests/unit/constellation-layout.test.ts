import { describe, expect, it } from "vitest";
import { dedupeEdges, layoutConstellation, layoutPages, LAYOUT, nodeSize, pageEnds, seededRandom, valueTier } from "@/server/services/constellation.service";

const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const edges = [
  { source: ids[0], target: ids[1], similarity: 0.8 },
  { source: ids[1], target: ids[2], similarity: 0.6 },
  { source: ids[0], target: ids[2], similarity: 0.5 },
  { source: ids[5], target: ids[6], similarity: 0.7 },
];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("node size", () => {
  it("is 12 + 4·sqrt(unique interested), capped at 64", () => {
    expect(nodeSize(0)).toBe(12);
    expect(nodeSize(9)).toBe(24);
    expect(nodeSize(100)).toBe(52);
    expect(nodeSize(169)).toBe(64);
    expect(nodeSize(10_000)).toBe(64);
  });

  it("ring tier follows completed Sandbox value", () => {
    expect([0, 1, 9_999, 10_000, 99_999, 100_000].map(valueTier)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe("Fruchterman–Reingold layout", () => {
  const layout = layoutConstellation(ids, edges);

  it("is deterministic and independent of input order", () => {
    expect(layoutConstellation(ids, edges)).toEqual(layout);
    expect(Object.fromEntries(layoutConstellation([...ids].reverse(), [...edges].reverse()))).toEqual(Object.fromEntries(layout));
  });

  it("places every node inside the frame without overlaps", () => {
    const points = ids.map((id) => layout.get(id)!);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(20);
      expect(p.x).toBeLessThanOrEqual(LAYOUT.width - 20);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(LAYOUT.height - 20);
    }
    for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) expect(dist(points[i], points[j])).toBeGreaterThan(40);
  });

  it("pulls similar clusters closer than unrelated ones", () => {
    const linked = edges.map((e) => dist(layout.get(e.source)!, layout.get(e.target)!));
    const all: number[] = [];
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) all.push(dist(layout.get(ids[i])!, layout.get(ids[j])!));
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(linked)).toBeLessThan(mean(all));
  });

  it("keeps pinned nodes in place when a page is added", () => {
    const first = layoutConstellation(ids.slice(0, 6), edges);
    const extended = layoutConstellation(ids, edges, { fixed: first });
    for (const id of ids.slice(0, 6)) expect(extended.get(id)).toEqual(first.get(id));
    expect(extended.size).toBe(12);
  });

  it("seeds initial positions by cluster id", () => {
    expect(seededRandom("a")()).toBe(seededRandom("a")());
    expect(seededRandom("a")()).not.toBe(seededRandom("b")());
  });
});

describe("pages and edges", () => {
  it("uses canonical pages of 150 then 50", () => {
    expect(pageEnds(12, 12)).toEqual([12]);
    expect(pageEnds(260, 150)).toEqual([150]);
    expect(pageEnds(260, 200)).toEqual([150, 200]);
    expect(pageEnds(260, 260)).toEqual([150, 200, 250, 260]);
  });

  it("lays out later pages around the earlier ones", () => {
    const many = Array.from({ length: 160 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const firstPage = layoutPages(many, [], 150);
    const both = layoutPages(many, [], 160);
    expect(firstPage.size).toBe(150);
    expect(both.size).toBe(160);
    for (const id of many.slice(0, 150)) expect(both.get(id)).toEqual(firstPage.get(id));
  });

  it("keeps one undirected edge per pair with the higher similarity", () => {
    expect(
      dedupeEdges([
        { source: "b", target: "a", similarity: 0.4 },
        { source: "a", target: "b", similarity: 0.5 },
        { source: "c", target: "a", similarity: 0.6 },
      ]),
    ).toEqual([
      { source: "a", target: "b", similarity: 0.5 },
      { source: "a", target: "c", similarity: 0.6 },
    ]);
  });
});
