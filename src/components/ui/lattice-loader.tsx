"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type Status = "working" | "done" | "error";
type Grid = 3 | 4;
type PatternName = "arrow" | "dots" | "orbit" | "ripple" | "snake" | "spiral" | "sweep" | "spin" | "rain" | "pulse";
type Pattern = { cells: (number | null)[]; loop?: number; scale?: number; lit?: 0.25 | 0.35 | 0.45 | 0.62 };
type ResolvedPattern = Required<Omit<Pattern, "lit">> & { lit?: Pattern["lit"] };

const PATTERNS: Partial<Record<PatternName, Partial<Record<Grid, ResolvedPattern>>>> = {
  arrow: { 3: { cells: [1, 2, 3, 0, 1, 2, 1, 2, 3], loop: 7.2, scale: 1 } },
  dots: { 3: { cells: [0, 1, 2, 0, 1, 2, 0, 1, 2], loop: 3, scale: 2.4 } },
  ripple: { 3: { cells: [2, 1, 2, 1, 0, 1, 2, 1, 2], loop: 4.8, scale: 1.5 } },
  spiral: { 3: { cells: [0, 1, 2, 7, 8, 3, 6, 5, 4], loop: 9, scale: 1.2, lit: 0.35 } },
  orbit: {
    3: { cells: [0, 1, 2, 7, null, 3, 6, 5, 4], loop: 8, scale: 1.2 },
    4: { cells: [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6], loop: 6, scale: 1.2, lit: 0.45 },
  },
  snake: {
    3: { cells: [0, 1, 2, 5, 4, 3, 6, 7, 8], loop: 9, scale: 1, lit: 0.35 },
    4: { cells: [0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11, 15, 14, 13, 12], loop: 16, scale: 1, lit: 0.25 },
  },
  sweep: { 4: { cells: [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6], loop: 5, scale: 1, lit: 0.45 } },
  spin: { 4: { cells: [0, 0, 1, 1, 0, 0, 1, 1, 3, 3, 2, 2, 3, 3, 2, 2], loop: 4, scale: 1.6, lit: 0.35 } },
  rain: { 4: { cells: [0, 2, 1, 3, 1, 3, 2, 4, 2, 4, 3, 5, 3, 5, 4, 6], loop: 4, scale: 1.2, lit: 0.35 } },
  pulse: { 4: { cells: [2, 1, 1, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 1, 1, 2], loop: 2.4, scale: 2.5, lit: 0.45 } },
};
const DEFAULT_PATTERN: Record<Grid, PatternName> = { 3: "orbit", 4: "sweep" };
const MARKS = { 3: { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] }, 4: { done: [7, 8, 10, 13], error: [0, 3, 5, 6, 9, 10, 12, 15] } };
const CELL = "h-[var(--ll-cell)] w-[var(--ll-cell)] [border-radius:max(1px,calc(var(--ll-cell)*0.25))] [background:var(--ll-color)] group-data-[shape=round]:rounded-full";
const LIT: Record<number, string> = { 62: "animate-[lattice-on_var(--ll-cycle)_infinite]", 45: "animate-[lattice-on-45_var(--ll-cycle)_infinite]", 35: "animate-[lattice-on-35_var(--ll-cycle)_infinite]", 25: "animate-[lattice-on-25_var(--ll-cycle)_infinite]" };
const STYLE = `@keyframes lattice-on{0%,100%{opacity:var(--ll-idle)}18%,42%{opacity:var(--ll-peak)}62%{opacity:var(--ll-idle)}}@keyframes lattice-on-45{0%,100%{opacity:var(--ll-idle)}13%,31%{opacity:var(--ll-peak)}45%{opacity:var(--ll-idle)}}@keyframes lattice-on-35{0%,100%{opacity:var(--ll-idle)}10%,24%{opacity:var(--ll-peak)}35%{opacity:var(--ll-idle)}}@keyframes lattice-on-25{0%,100%{opacity:var(--ll-idle)}7%,17%{opacity:var(--ll-peak)}25%{opacity:var(--ll-idle)}}@media(prefers-reduced-motion:reduce){.ll-run{--ll-peak:.7}.ll-run>span{animation-delay:0ms!important;animation-duration:1400ms!important}.ll-mark{transform:none!important}.ll-text{filter:none!important}}`;

function resolvePattern(pattern: PatternName | Pattern, grid: Grid): ResolvedPattern {
  if (typeof pattern === "string") return PATTERNS[pattern]?.[grid] ?? PATTERNS[DEFAULT_PATTERN[grid]]![grid]!;
  const cells = Array.from({ length: grid * grid }, (_, index) => pattern.cells[index] ?? null);
  const max = Math.max(0, ...cells.filter((value): value is number => value !== null));
  return { cells, loop: pattern.loop ?? max + 4.2, scale: pattern.scale ?? 1, lit: pattern.lit ?? 0.62 };
}
const format = (deciseconds: number) => deciseconds < 600 ? `${(deciseconds / 10).toFixed(1)}s` : `${Math.floor(deciseconds / 600)}m ${((deciseconds % 600) / 10).toFixed(1)}s`;

export type LatticeLoaderProps = {
  label?: string; doneLabel?: string; errorLabel?: string; status?: Status; pattern?: PatternName | Pattern; grid?: Grid;
  shape?: "square" | "round"; color?: string; doneColor?: string; errorColor?: string; cellSize?: number; gap?: number;
  fontSize?: number; step?: number; idleOpacity?: number; glow?: boolean; glowColor?: string; showTimer?: boolean;
  elapsed?: number; className?: string; style?: CSSProperties;
};

export function LatticeLoader({ label = "Thinking", doneLabel = "Done in", errorLabel = "Failed after", status = "working", pattern = "orbit", grid = 3, shape = "round", color = "currentColor", doneColor = "#5fba87", errorColor = "#dc5f5f", cellSize = 6, gap = 2, fontSize = 14, step = 90, idleOpacity = 0.15, glow = false, glowColor = "", showTimer = true, elapsed, className = "", style }: LatticeLoaderProps) {
  const patternData = resolvePattern(pattern, grid);
  const delay = step * patternData.scale;
  const timerRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(0);
  const mark = status === "error" ? "error" : "done";
  const [announcement, setAnnouncement] = useState(`${label}, in progress`);

  useLayoutEffect(() => {
    const paint = (value: number) => { elapsedRef.current = value; if (timerRef.current) timerRef.current.textContent = format(value); };
    if (elapsed !== undefined) { paint(Math.round(elapsed * 10)); return; }
    if (status !== "working") return;
    const startedAt = performance.now();
    paint(0);
    const id = window.setInterval(() => paint(Math.floor((performance.now() - startedAt) / 100)), 100);
    return () => window.clearInterval(id);
  }, [status, elapsed]);
  useEffect(() => {
    setAnnouncement(status === "working" ? `${label}, in progress` : `${status === "done" ? doneLabel : errorLabel}${showTimer ? ` ${format(elapsedRef.current)}` : ""}`);
  }, [status, label, doneLabel, errorLabel, showTimer]);

  const variables = {
    "--ll-n": grid, "--ll-cell": `${cellSize}px`, "--ll-gap": `${gap}px`, "--ll-font": `${fontSize}px`, "--ll-color": color,
    "--ll-mark": status === "error" ? errorColor : doneColor, "--ll-idle": idleOpacity, "--ll-glow": glowColor || color,
    "--ll-mark-glow": glowColor || (status === "error" ? errorColor : doneColor), "--ll-cycle": `${Math.round(patternData.loop * delay)}ms`, "--ll-peak": 1,
    ...style,
  } as CSSProperties;
  return <span role="status" className={`ll-root group relative inline-flex items-center leading-none [gap:calc(var(--ll-font)*0.625)] [font-size:var(--ll-font)] ${className}`} data-status={status} data-shape={shape} data-glow={glow ? "" : undefined} style={variables}>
    <style>{STYLE}</style>
    <span className="grid shrink-0" aria-hidden="true">
      <span className="ll-run [grid-area:1/1] grid [grid-template-columns:repeat(var(--ll-n),var(--ll-cell))] [gap:var(--ll-gap)] transition-opacity group-data-[status=done]:opacity-0 group-data-[status=error]:opacity-0">
        {patternData.cells.map((unit, index) => <span key={index} className={unit === null ? `${CELL} [opacity:calc(var(--ll-idle)*0.47)]` : `${CELL} [opacity:var(--ll-idle)] ${LIT[Math.round((patternData.lit ?? 0.62) * 100)] ?? LIT[62]}`} style={unit === null ? undefined : { animationDelay: `${Math.round(unit * delay)}ms` }} />)}
      </span>
      <span className="ll-mark [grid-area:1/1] grid [grid-template-columns:repeat(var(--ll-n),var(--ll-cell))] [gap:var(--ll-gap)] scale-90 opacity-0 transition group-data-[status=done]:scale-100 group-data-[status=done]:opacity-100 group-data-[status=error]:scale-100 group-data-[status=error]:opacity-100">
        {patternData.cells.map((_, index) => <span key={index} className={`${CELL} [opacity:var(--ll-idle)] transition data-[on]:[background:var(--ll-mark)] data-[on]:opacity-100`} data-on={MARKS[grid][mark].includes(index) ? "" : undefined} />)}
      </span>
    </span>
    <span className="font-medium" aria-hidden="true">{status === "working" ? label : status === "done" ? doneLabel : errorLabel}</span>
    {showTimer ? <span ref={timerRef} className="font-mono text-[.875em] tabular-nums opacity-60" aria-hidden="true">0.0s</span> : null}
    <span className="sr-only">{announcement}</span>
  </span>;
}
