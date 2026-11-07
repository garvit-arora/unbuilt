"use client";
import "./globals.css";

/** Replaces the root layout when the layout itself fails (it renders its own document). */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="dark">
      <body className="flex min-h-screen flex-col bg-[#07080a] text-[#ededE6]">
        <title>UNBUILT · Error</title>
        <section className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24" role="alert">
          <h1 className="font-serif text-4xl">UNBUILT could not load.</h1>
          <p className="opacity-70">Try again in a moment.</p>
          <button type="button" onClick={() => retry()} className="rounded-md bg-[#c6f432] px-4 py-2 text-sm font-medium text-[#07080a]">
            Try again
          </button>
        </section>
      </body>
    </html>
  );
}
