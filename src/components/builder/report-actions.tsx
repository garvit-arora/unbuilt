"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReportActions() {
  return <Button variant="outline" onClick={() => window.print()}><Printer aria-hidden /> Print / save PDF</Button>;
}
