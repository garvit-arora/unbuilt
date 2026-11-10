import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
import { AppFrame } from "@/components/layout/app-frame";
import { getOptionalSessionUser } from "@/server/auth/guards";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "UNBUILT", template: "%s · UNBUILT" },
  description: "The market for things that don't exist. Yet. Discover what the world is already willing to buy.",
};

export const viewport: Viewport = {
  themeColor: "#faf9f2",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalSessionUser();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={200}>
          <AppFrame user={user ? { displayName: user.displayName, email: user.email, role: user.role } : null}>{children}</AppFrame>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
