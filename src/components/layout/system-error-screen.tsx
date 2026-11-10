"use client";

import { ArrowLeft, Menu, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Kind = "not-found" | "server" | "error";
const links = [["Overview", "/dashboard"], ["Discover demand", "/discover"], ["Make a wish", "/wish"], ["Builder workspace", "/builder"]] as const;

export function SystemErrorScreen({ kind, onRetry, digest }: { kind: Kind; onRetry?: () => void; digest?: string | null }) {
  const [open, setOpen] = useState(false);
  const [scaleY, setScaleY] = useState(1);
  const codeRef = useRef<HTMLDivElement>(null);
  const code = kind === "not-found" ? "404" : kind === "server" ? "503" : "500";
  const heading = kind === "not-found" ? "This trail hasn’t been built yet." : kind === "server" ? "UNBUILT is taking a quick pause." : "Something went off the blueprint.";
  const copy = kind === "not-found" ? "The page may have moved, or it might still be waiting for someone to build it." : "Your work is safe. Try again, or return to the overview while the service reconnects.";
  const retry = onRetry ?? (() => window.location.reload());

  useEffect(() => {
    const measure = () => { const height = codeRef.current?.offsetHeight ?? window.innerHeight; setScaleY(Math.max(1, window.innerHeight / Math.max(height, 1))); };
    measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => { document.body.style.overflow = open ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [open]);

  return <main className={cn("system-error-screen", kind !== "not-found" && "is-server")} role={kind === "not-found" ? undefined : "alert"} data-testid="system-error-screen">
    <div className="system-error-backdrop" aria-hidden><div ref={codeRef} className="system-error-code" style={{ transform: `translate(-50%,-50%) scale(1.15,${scaleY * 1.4})` }}>{code}</div><div className="system-error-oval" style={{ transform: `translate(-50%,-50%) scaleY(${scaleY})` }} /></div>
    <nav className="system-error-nav" aria-label="Error page navigation"><Link href="/" className="system-error-brand"><span className="system-error-mark"><i /><i /><i /><i /></span><b>unbuilt.</b></Link><div className="system-error-links">{links.slice(0, 3).map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</div><button type="button" className="system-error-menu-button" onClick={() => setOpen(true)}><Menu aria-hidden /><span>Menu</span></button></nav>
    <div className="system-error-motion" aria-hidden><video autoPlay loop muted playsInline poster="/main3.png"><source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260713_234424_b1332b69-2e69-4302-8dbc-40f86846afbd.mp4" type="video/mp4" /></video></div>
    <section className="system-error-content"><span>{code}{digest ? ` · ${digest}` : ""}</span><h1>{heading}</h1><p>{copy}</p><div>{kind !== "not-found" ? <button type="button" onClick={retry}><RefreshCw aria-hidden />Try again</button> : null}<Link href="/"><ArrowLeft aria-hidden />Back to home</Link></div></section>
    <div className={cn("system-error-drawer", open && "is-open")} aria-hidden={!open}><button className="system-error-scrim" type="button" aria-label="Close menu" onClick={() => setOpen(false)} /><aside aria-label="Quick navigation"><header><span className="system-error-brand"><span className="system-error-mark"><i /><i /><i /><i /></span><b>unbuilt.</b></span><button type="button" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button></header><div>{links.map(([label, href], index) => <Link href={href} key={href} style={{ transitionDelay: open ? `${150 + index * 60}ms` : "0ms" }}>{label}</Link>)}</div><Link className="system-error-drawer-home" href="/"><ArrowLeft />Back to home</Link></aside></div>
  </main>;
}
