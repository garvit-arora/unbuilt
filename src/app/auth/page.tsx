import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/layout/auth-form";
import svg1 from "@/app/svg1.svg";
import svg2 from "@/app/svg2.svg";
import svg3 from "@/app/svg3.svg";
import { safeNextPath } from "@/lib/safe-next";
import { getOptionalSessionUser } from "@/server/auth/guards";
import { env } from "@/server/config/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const user = await getOptionalSessionUser();
  if (user) redirect(next);

  return (
    <main className="auth-standalone">
      <a href="/auth" className="auth-logo">unbuilt<span>.</span></a>
      <div className="auth-illustrations" aria-hidden="true">
        <Image className="auth-illustration auth-art-one" src={svg1} alt="" priority />
        <Image className="auth-illustration auth-art-two" src={svg2} alt="" priority />
        <Image className="auth-illustration auth-art-three" src={svg3} alt="" priority />
      </div>
      <section className="auth-card">
        {env.supabase.configured ? <AuthForm next={next} /> : (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Sign-in is unavailable: Supabase is not configured (missing {env.supabase.missing.join(", ")}). For local
          development run <code className="font-mono">npx supabase start</code> and{" "}
          <code className="font-mono">npm run db:env</code>.
        </p>
        )}
      </section>
      <p className="auth-footer">Ideas deserve a place to begin.</p>
    </main>
  );
}
