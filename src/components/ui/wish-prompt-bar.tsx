"use client";
import { ArrowUp, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export function WishPromptBar({ value, onChange, busy, disabled }: { value: string; onChange: (value: string) => void; busy: boolean; disabled: boolean }) {
  return <div className="wish-prompt-bar" data-busy={busy ? "" : undefined}>
    <div className="wish-prompt-label"><Sparkles size={16} aria-hidden /><span>Describe the missing product in your own words</span></div>
    <Textarea id="wish-text" value={value} onChange={event => onChange(event.target.value)} rows={6} maxLength={2000} placeholder="I wish there were a product that…" />
    <div className="wish-prompt-foot"><span>{value.length}/2000</span><button type="submit" aria-label="Analyze my wish" disabled={disabled}><ArrowUp aria-hidden /></button></div>
  </div>;
}
