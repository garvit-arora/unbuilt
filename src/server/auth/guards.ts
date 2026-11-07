import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getServiceClient } from "@/server/db/service-client";
import { getSessionClient } from "@/server/db/session-client";
import { AppError } from "@/server/http/errors";
import { logger } from "@/server/http/logger";

export type UserRole = "buyer" | "builder" | "admin";

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: UserRole;
  isPlatformBuilder: boolean;
};

/**
 * Current user from the Supabase session cookie, with the role read through the service client
 * (clients cannot select `profiles.role`, design 5.8). Returns null when signed out or Supabase is unavailable.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  let authUser: { id: string; email?: string | null } | null = null;
  try {
    const supabase = await getSessionClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    authUser = data.user;
  } catch (error) {
    // cookies() signals dynamic rendering by throwing; that must reach Next.js.
    unstable_rethrow(error);
    logger.warn("auth.session_unavailable", { error });
    return null;
  }

  const { data: profile, error } = await getServiceClient()
    .from("profiles")
    .select("display_name, role, is_platform_builder")
    .eq("id", authUser.id)
    .maybeSingle();
  if (error) {
    logger.error("auth.profile_lookup_failed", { userId: authUser.id, error: error.message });
    throw new AppError("INTERNAL_ERROR", 500, "Could not load your profile");
  }
  if (!profile) return null;

  return {
    id: authUser.id,
    email: authUser.email ?? null,
    displayName: profile.display_name,
    role: profile.role,
    isPlatformBuilder: profile.is_platform_builder,
  };
}

/** For pages and layout chrome: a failed profile lookup renders as signed out instead of an error page. */
export async function getOptionalSessionUser(): Promise<SessionUser | null> {
  try {
    return await getSessionUser();
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", 401);
  return user;
}

/** Throws FORBIDDEN unless the user has one of `roles`. */
export function assertRole(user: SessionUser, roles: readonly UserRole[]): void {
  if (roles.length > 0 && !roles.includes(user.role)) throw new AppError("FORBIDDEN", 403);
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  assertRole(user, roles);
  return user;
}

/** Role matrix (design 6.2): builder actions for builder|admin, admin actions for admin only. */
export const BUILDER_ROLES: readonly UserRole[] = ["builder", "admin"];
export const ADMIN_ROLES: readonly UserRole[] = ["admin"];
