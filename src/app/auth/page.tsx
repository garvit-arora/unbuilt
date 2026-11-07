import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import { safeNextPath } from "@/lib/safe-next";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const user = await getOptionalSessionUser();
  if (user) redirect(next);

  // The demo password reaches the client only in demo mode (design 6.2); otherwise the prop is undefined.
  const demoPassword = env.demoMode ? env.demoAccountPassword : undefined;
  const initialTab = params.tab === "sign-up" ? "sign-up" : "sign-in";

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-16 sm:py-24">
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-4xl text-foreground">Welcome to UNBUILT</h1>
        <p className="text-sm text-muted-text">
          Sign in to share what you wish existed, join people who want the same thing, or build it.
        </p>
      </header>
      {env.supabase.configured ? (
        <AuthForm next={next} demoPassword={demoPassword} initialTab={initialTab} />
      ) : (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Sign-in is unavailable: Supabase is not configured (missing {env.supabase.missing.join(", ")}). For local
          development run <code className="font-mono">npx supabase start</code> and{" "}
          <code className="font-mono">npm run db:env</code>.
        </p>
      )}
    </section>
  );
}
