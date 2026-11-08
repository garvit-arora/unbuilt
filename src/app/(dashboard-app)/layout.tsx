import { redirect } from "next/navigation";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { loadDashboard } from "@/server/services/dashboard.service";
import "@/app/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

/**
 * Shared layout for /dashboard and /payments.
 * Applies the light theme (html.light) and replaces the global site header with
 * the Ofspace-style left sidebar. No global site header or footer is rendered here.
 */
export default async function DashboardAppLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalSessionUser();
  if (!user) redirect("/auth?next=/dashboard");

  const data = await loadDashboard(user.id);

  const recentClusters = data.clusters.slice(0, 4).map((c) => ({ slug: c.slug, title: c.title }));
  const unreadCount = data.notifications.filter((n) => !n.read).length;

  return (
    <html
      lang="en"
      /* light overrides the :root dark tokens; see globals.css .light block */
      className={`light ${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex h-full overflow-hidden bg-[#f8f9fa] font-sans text-[#111827] antialiased">
        <TooltipProvider delayDuration={200}>
          {/* Left sidebar */}
          <DashboardSidebar
            displayName={user.displayName}
            email={user.email}
            role={user.role}
            recentClusters={recentClusters}
            unreadCount={unreadCount}
          />

          {/* Main content area */}
          <div className="flex min-h-full flex-1 flex-col overflow-y-auto">
            <main className="flex-1">{children}</main>
          </div>

          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
