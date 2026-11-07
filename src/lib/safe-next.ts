/**
 * Sanitizes a `?next=` redirect target: only same-site absolute paths are allowed, so the sign-in page cannot be
 * used as an open redirect.
 */
export function safeNextPath(next: string | string[] | undefined | null, fallback = "/"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  if (value === "/auth" || value.startsWith("/auth?") || value.startsWith("/auth/")) return fallback;
  return value;
}
