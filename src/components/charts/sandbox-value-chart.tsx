"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCents } from "@/lib/money";

/** Completed PayPal Sandbox value per cluster (spec 8J "revenue per cluster"). Only captured payments, net of refunds. */

const AXIS = { stroke: "#8a8f98", fontSize: 11, tickLine: false, axisLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: "#14171c", border: "1px solid #22262e", borderRadius: 8, color: "#edede6", fontSize: 12 },
  labelStyle: { color: "#8a8f98" },
  cursor: { fill: "rgba(237,237,230,0.04)" },
} as const;

export function SandboxValueChart({ rows }: { rows: { title: string; completedValueCents: number }[] }) {
  const data = rows
    .filter((r) => r.completedValueCents > 0)
    .slice(0, 8)
    .map((r) => ({ title: r.title.length > 26 ? `${r.title.slice(0, 25)}…` : r.title, value: r.completedValueCents }));
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid="chart-sandbox-value">
      <figcaption>
        <div className="text-sm font-medium text-foreground">Completed Sandbox value per cluster</div>
        <div className="text-xs text-muted-text">Captured PayPal Sandbox payments minus completed refunds. Test money only.</div>
      </figcaption>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 24 }}>
            <CartesianGrid stroke="#22262e" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" {...AXIS} tickFormatter={(v: number) => formatCents(v)} />
            <YAxis type="category" dataKey="title" {...AXIS} width={190} interval={0} />
            <Tooltip {...TOOLTIP} formatter={(v) => [formatCents(Number(v)), "PayPal Sandbox"]} />
            <Bar dataKey="value" fill="#c6f432" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
