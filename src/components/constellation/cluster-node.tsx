"use client";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import type { ConstellationNode } from "@/lib/views";

/**
 * One cluster in the constellation (design 11): diameter from unique interest, fill from category, and a lime ring
 * whose thickness grows with completed PayPal Sandbox value. Handles sit invisibly at the centre so edges join
 * circle centres.
 */

export type ClusterNodeData = { node: ConstellationNode; color: string; showLabel: boolean; selected: boolean };
export type ClusterFlowNode = Node<ClusterNodeData, "cluster">;

const HANDLE: CSSProperties = {
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  opacity: 0,
  pointerEvents: "none",
};

const RING_PX = [0, 2, 3, 5] as const;

function ClusterNodeView({ data }: NodeProps<ClusterFlowNode>) {
  const { node, color, showLabel, selected } = data;
  const ring = RING_PX[node.valueTier];
  const shadow = [
    ring ? `0 0 0 ${ring}px #c6f432` : null,
    selected ? `0 0 0 ${ring + 3}px rgba(237,237,230,0.85)` : null,
    node.paidBuyers > 0 ? "0 0 18px rgba(198,244,50,0.45)" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div
      className="relative cursor-pointer rounded-full transition-[box-shadow,transform] duration-200 ease-out hover:scale-110 motion-reduce:transition-none"
      style={{ width: node.size, height: node.size, background: color, opacity: node.paidBuyers > 0 ? 1 : 0.82, boxShadow: shadow || undefined }}
      data-testid="constellation-node"
      data-slug={node.slug}
      title={`${node.title}: ${node.uniqueInterested} interested, ${node.paidBuyers} paid (PayPal Sandbox)`}
    >
      <Handle type="target" position={Position.Top} style={HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={HANDLE} isConnectable={false} />
      {showLabel || selected ? (
        <span className="pointer-events-none absolute top-full left-1/2 mt-1.5 w-max max-w-40 -translate-x-1/2 text-center text-[10px] leading-tight text-foreground/80">
          {node.title}
        </span>
      ) : null}
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeView);
