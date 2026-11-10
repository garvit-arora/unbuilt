"use client";
import { useEffect, useRef } from "react";

export function Ferrofluid({ className = "", lightMode = true, mouseInteraction = true }: { className?: string; lightMode?: boolean; mouseInteraction?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let pointer = { x: .72, y: .35 };
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => { const ratio = Math.min(devicePixelRatio || 1, 2); canvas.width = canvas.clientWidth * ratio; canvas.height = canvas.clientHeight * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0); };
    const move = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); pointer = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
    const draw = (time = 0) => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      const ink = lightMode ? [102, 129, 176] : [18, 15, 23];
      for (let index = 0; index < 16; index++) {
        const phase = index * .77 + time * .00018;
        const baseX = width * (.08 + (index % 6) * .18);
        const baseY = height * (.2 + Math.floor(index / 6) * .33);
        const pull = Math.max(0, 1 - Math.hypot(baseX / width - pointer.x, baseY / height - pointer.y) * 2.4);
        const x = baseX + Math.sin(phase) * 34 + pull * (pointer.x * width - baseX) * .22;
        const y = baseY + Math.cos(phase * 1.3) * 28 + pull * (pointer.y * height - baseY) * .22;
        const radius = 90 + Math.sin(phase * 1.7) * 24 + pull * 55;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${ink.join(",")},${.2 + pull * .12})`);
        gradient.addColorStop(.45, `rgba(${ink.join(",")},.08)`);
        gradient.addColorStop(1, `rgba(${ink.join(",")},0)`);
        context.fillStyle = gradient;
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      }
      if (!reduce) frame = requestAnimationFrame(draw);
    };
    resize(); draw();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    if (mouseInteraction) window.addEventListener("pointermove", move, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("pointermove", move); };
  }, [lightMode, mouseInteraction]);
  return <canvas ref={canvasRef} className={`ferrofluid-canvas ${className}`} aria-hidden />;
}
