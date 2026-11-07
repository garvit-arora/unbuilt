"use client";
import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from "@xyflow/react";
import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api-client";
import { CATEGORY_COLORS, type Category } from "@/lib/categories";
import { CONSTELLATION_PAGE } from "@/lib/schemas/ai";
import type { ConstellationData, ConstellationNode } from "@/lib/views";
import { ClusterNode, type ClusterFlowNode } from "./cluster-node";
import { ConstellationPanel } from "./constellation-panel";

/**
 * Demand Constellation (spec 14, design 11) on `@xyflow/react`: zoom/pan, search that focuses a node, click to
 * inspect (side panel), "Load more" for clusters beyond the first 150. Positions come from the server layout.
 * `mini` (home page) shows the same map without panel and search; clicking a node opens its demand page.
 */

const NODE_TYPES = { cluster: ClusterNode };
const LABEL_LIMIT = 40;

const colorOf = (category: string) => CATEGORY_COLORS[category as Category] ?? "#8a8f98";

function toFlowNodes(nodes: readonly ConstellationNode[], selectedId: string | null): ClusterFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: "cluster",
    position: { x: node.x - node.size / 2, y: node.y - node.size / 2 },
    width: node.size,
    height: node.size,
    data: { node, color: colorOf(node.category), showLabel: nodes.length <= LABEL_LIMIT, selected: node.id === selectedId },
    draggable: false,
    connectable: false,
  }));
}

function Constellation({ initial, mode }: { initial: ConstellationData; mode: "full" | "mini" }) {
  const router = useRouter();
  const flow = useReactFlow();
  const [data, setData] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const nodes = useMemo(() => toFlowNodes(data.nodes, selectedId), [data.nodes, selectedId]);
  const edges = useMemo<Edge[]>(
    () =>
      data.edges.map((e) => {
        const active = hoveredEdge === e.id || e.source === selectedId || e.target === selectedId;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "straight",
          selectable: false,
          focusable: false,
          style: { stroke: active ? "#38d6e8" : "#2c313a", strokeWidth: active ? 1.5 : 1 + e.similarity },
          label: hoveredEdge === e.id ? `similarity ${e.similarity.toFixed(2)}${e.sharedTags.length ? ` · shared: ${e.sharedTags.length}` : ""}` : undefined,
          labelStyle: { fill: "#edede6", fontSize: 10 },
          labelBgStyle: { fill: "#14171c" },
        };
      }),
    [data.edges, hoveredEdge, selectedId],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  function focus(node: ConstellationNode) {
    setSelectedId(node.id);
    void flow.setCenter(node.x, node.y, { zoom: Math.max(flow.getZoom(), 1.3), duration: 400 });
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const hit = data.nodes.find((n) => words.every((w) => n.title.toLowerCase().includes(w)));
    if (hit) {
      setMessage(null);
      focus(hit);
    } else setMessage(`No cluster title matches "${query.trim()}".`);
  }

  async function loadMore() {
    if (data.nextOffset === null) return;
    setLoading(true);
    setMessage(null);
    try {
      const next = await api<ConstellationData>(`/api/demand/constellation?offset=${data.nextOffset}&limit=${CONSTELLATION_PAGE}`);
      setData((current) => {
        const known = new Set(current.nodes.map((n) => n.id));
        const edgeIds = new Set(current.edges.map((e) => e.id));
        return {
          ...next,
          nodes: [...current.nodes, ...next.nodes.filter((n) => !known.has(n.id))],
          edges: [...current.edges, ...next.edges.filter((e) => !edgeIds.has(e.id))],
        };
      });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const related = selected
    ? data.edges
        .filter((e) => e.source === selected.id || e.target === selected.id)
        .map((e) => ({ node: byId.get(e.source === selected.id ? e.target : e.source), similarity: e.similarity, sharedTags: e.sharedTags }))
        .filter((r): r is { node: ConstellationNode; similarity: number; sharedTags: string[] } => Boolean(r.node))
        .sort((a, b) => b.similarity - a.similarity)
    : [];

  const canvas = (
    <div className={mode === "mini" ? "h-80 w-full" : "h-[520px] w-full lg:h-[620px]"}>
      <ReactFlow<ClusterFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={3}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        panOnDrag={mode === "full"}
        zoomOnScroll={mode === "full"}
        zoomOnPinch={mode === "full"}
        zoomOnDoubleClick={false}
        preventScrolling={mode === "full"}
        onNodeClick={(_, node) => {
          if (mode === "mini") router.push(`/demand/${node.data.node.slug}`);
          else setSelectedId(node.id);
        }}
        onPaneClick={() => setSelectedId(null)}
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        style={{ background: "transparent" }}
      >
        <Background color="#22262e" gap={28} size={1} />
        {mode === "full" ? <Controls showInteractive={false} position="bottom-left" /> : null}
      </ReactFlow>
    </div>
  );

  if (mode === "mini") {
    return (
      <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="constellation-mini">
        {canvas}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="constellation">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={search} className="flex gap-2" role="search" aria-label="Find a cluster in the constellation">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-text" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a cluster"
              className="w-64 pl-8"
              aria-label="Find a cluster"
              data-testid="constellation-search"
            />
          </div>
          <Button type="submit" variant="outline">
            Focus
          </Button>
        </form>
        <p className="text-xs text-muted-text">
          {data.nodes.length} of {data.total} clusters · edges link clusters whose wishes are semantically similar ({data.space === "model" ? "model" : "local fallback"}{" "}
          embeddings)
        </p>
      </div>
      {message ? (
        <p role="status" className="text-sm text-muted-text">
          {message}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">{canvas}</div>
        <ConstellationPanel selected={selected} related={related} onSelect={(n) => focus(n)} color={selected ? colorOf(selected.category) : undefined} />
      </div>
      {data.nextOffset !== null ? (
        <Button variant="outline" className="w-fit" onClick={loadMore} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Load {Math.min(CONSTELLATION_PAGE, data.total - data.nodes.length)} more clusters
        </Button>
      ) : null}
      <p className="text-xs text-muted-text">
        Node size = unique interested buyers · colour = category · lime ring = completed PayPal Sandbox purchases (thicker = more value).{" "}
        <Link href="/discover" className="text-lime underline-offset-4 hover:underline">
          Back to the grid
        </Link>
      </p>
    </div>
  );
}

export function ConstellationView({ initial, mode = "full" }: { initial: ConstellationData; mode?: "full" | "mini" }) {
  if (initial.nodes.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-6 text-sm text-muted-text">No demand clusters to map yet.</p>;
  }
  return (
    <ReactFlowProvider>
      <Constellation initial={initial} mode={mode} />
    </ReactFlowProvider>
  );
}
