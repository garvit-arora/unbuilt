"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Demand charts (design 11, Demand tab; spec 6B). Every series comes from stored rows via the metrics cache. */

const AXIS = { stroke: "#8a8f98", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "#22262e", strokeDasharray: "3 3" } as const;
const TOOLTIP = {
  contentStyle: { background: "#14171c", border: "1px solid #22262e", borderRadius: 8, color: "#edede6", fontSize: 12 },
  labelStyle: { color: "#8a8f98" },
  cursor: { fill: "rgba(237,237,230,0.04)" },
} as const;

function Frame({ title, description, children, testId }: { title: string; description: string; children: React.ReactNode; testId: string }) {
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid={testId}>
      <figcaption>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-text">{description}</div>
      </figcaption>
      <div className="h-56 w-full">{children}</div>
    </figure>
  );
}

export function GrowthChart({ series }: { series: { date: string; members: number }[] }) {
  return (
    <Frame title="Growth over time" description="Cumulative unique members by join date, last 60 days" testId="chart-growth">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" {...AXIS} minTickGap={32} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...AXIS} allowDecimals={false} />
          <Tooltip {...TOOLTIP} formatter={(v) => [v, "Members"]} />
          <Line type="monotone" dataKey="members" stroke="#c6f432" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function WtpOverTimeChart({ series }: { series: { date: string; n: number; medianCents: number | null }[] }) {
  const data = series.map((p) => ({ date: p.date, median: p.medianCents === null ? null : p.medianCents / 100, n: p.n }));
  return (
    <Frame title="Stated willingness to pay over time" description="Median target price of price-qualified buyers after each day with changes (shown from n=3). Not payments." testId="chart-wtp-time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" {...AXIS} minTickGap={32} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis {...AXIS} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip {...TOOLTIP} formatter={(v, _name, item) => [v === null ? "n<3" : `$${v} (n=${(item.payload as { n: number }).n})`, "Median"]} />
          <Line type="stepAfter" dataKey="median" stroke="#38d6e8" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function WtpHistogram({ histogram, n }: { histogram: { label: string; count: number }[]; n: number }) {
  return (
    <Frame title="Stated willingness to pay" description={`Target prices of price-qualified buyers (n=${n}). Not payments.`} testId="chart-wtp">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={histogram} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} />
          <Tooltip {...TOOLTIP} formatter={(v) => [v, "Buyers"]} />
          <Bar dataKey="count" fill="#38d6e8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function FunnelChart({ interested, priceQualified, paid }: { interested: number; priceQualified: number; paid: number }) {
  const data = [
    { stage: "Interested", value: interested },
    { stage: "Price-qualified", value: priceQualified },
    { stage: "Paid (PayPal Sandbox)", value: paid },
  ];
  return (
    <Frame title="Interest vs confirmed purchases" description="Stated interest is not a payment; paid counts only captured Sandbox payments" testId="chart-funnel">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 24 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} allowDecimals={false} />
          <YAxis type="category" dataKey="stage" {...AXIS} width={120} />
          <Tooltip {...TOOLTIP} formatter={(v) => [v, "Buyers"]} />
          <Bar dataKey="value" fill="#c6f432" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}

export function FeatureFrequencyChart({ features }: { features: { title: string; mentionPct: number; explicitPct: number }[] }) {
  const data = features.slice(0, 8).map((f) => ({
    title: f.title.length > 26 ? `${f.title.slice(0, 25)}…` : f.title,
    mentioned: Math.round(f.mentionPct * 100),
    voted: Math.round(f.explicitPct * 100),
  }));
  return (
    <Frame title="Feature frequency" description="% of interested buyers who mentioned (AI-extracted) or voted for each requirement" testId="chart-features">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 24 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} domain={[0, 100]} unit="%" />
          <YAxis type="category" dataKey="title" {...AXIS} width={190} interval={0} />
          <Tooltip {...TOOLTIP} formatter={(v, name) => [`${v}%`, name === "mentioned" ? "Mentioned" : "Voted for"]} />
          <Bar dataKey="mentioned" fill="#38d6e8" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="voted" fill="#c6f432" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  );
}
