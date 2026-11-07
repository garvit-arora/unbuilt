export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-text sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-serif text-base text-foreground">UNBUILT</span>
          <span className="mx-2" aria-hidden>
            ·
          </span>
          The market for things that don&apos;t exist. Yet.
        </p>
        <p>Payments run in PayPal Sandbox with test money only. MIT licensed.</p>
      </div>
    </footer>
  );
}
