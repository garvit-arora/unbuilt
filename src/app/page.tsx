import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = { title: "Ideas worth building", description: "Turn unmet needs into researched ideas, shared buyer intent, and opportunities builders can trust." };

export default function HomePage() { return <LandingPage />; }
