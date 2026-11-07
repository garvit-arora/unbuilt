/**
 * Seed account creation (design 13 step 1, patch NIT 2). Users are created with a deterministic id; an existing
 * user is accepted only when its id is the seed id, otherwise the seed aborts with an actionable message.
 */
import { seedUserId } from "./ids";

export type SeedAccount = {
  email: string;
  password: string;
  displayName: string;
  role: "buyer" | "builder" | "admin";
};

type AuthErrorLike = { message: string; status?: number; code?: string } | null;

/** The subset of `supabase.auth.admin` the seed uses (a fake implements it in seed-ids.test.ts). */
export type AdminAuth = {
  createUser(attributes: {
    id: string;
    email: string;
    password: string;
    email_confirm: boolean;
    user_metadata: Record<string, unknown>;
  }): Promise<{ data: { user: { id: string } | null }; error: AuthErrorLike }>;
  listUsers(params: { page: number; perPage: number }): Promise<{
    data: { users: { id: string; email?: string | null }[] } | null;
    error: AuthErrorLike;
  }>;
};

export type SeedLog = (message: string) => void;

export function isEmailExists(error: AuthErrorLike): boolean {
  if (!error) return false;
  return error.code === "email_exists" || (error.status === 422 && /already been registered/i.test(error.message));
}

export async function findUserIdByEmail(admin: AdminAuth, email: string, perPage = 1000): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page < 1000; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit.id;
    if (users.length < perPage) return null;
  }
  return null;
}

export function nonSeedIdMessage(email: string): string {
  return `User ${email} exists with a non-seed id; delete it or run \`supabase db reset\``;
}

/** Creates the account or confirms the existing one has the seed id. Returns the id. */
export async function ensureSeedUser(admin: AdminAuth, account: SeedAccount, log: SeedLog = () => {}): Promise<string> {
  const id = seedUserId(account.email);
  const { data, error } = await admin.createUser({
    id,
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { display_name: account.displayName, role: account.role === "admin" ? "buyer" : account.role },
  });
  if (!error) return data.user?.id ?? id;
  if (!isEmailExists(error)) throw new Error(`Creating ${account.email} failed: ${error.message}`);
  const existingId = await findUserIdByEmail(admin, account.email);
  if (existingId !== id) throw new Error(nonSeedIdMessage(account.email));
  log(`info: ${account.email} already exists with its seed id; keeping it`);
  return id;
}
