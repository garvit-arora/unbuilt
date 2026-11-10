import "server-only";
import { RoleChangeSchema, type AccountRole } from "@/lib/schemas/auth";
import type { SessionUser } from "@/server/auth/guards";
import { getServiceClient } from "@/server/db/service-client";
import { dbFail } from "@/server/db/repositories/db-error";
import { AppError } from "@/server/http/errors";
import { recordAudit, type AuditEntry } from "./audit.service";

type AccountDeps = {
  changeRole: (userId: string, from: AccountRole, to: AccountRole) => Promise<boolean>;
  audit: (entry: AuditEntry) => Promise<void>;
};

export function createAccountService(deps: AccountDeps) {
  async function changeRole(user: Pick<SessionUser, "id" | "role">, requestedRole: AccountRole) {
    const { role } = RoleChangeSchema.parse({ role: requestedRole });
    if (user.role === "admin") throw new AppError("FORBIDDEN", 403, "Admin accounts cannot change their role here.");
    if (user.role === role) return { role };
    const changed = await deps.changeRole(user.id, user.role, role);
    if (!changed) throw new AppError("CONFLICT", 409, "Your account role changed in another session. Refresh and try again.");
    await deps.audit({ actorId: user.id, action: "account.role_changed", entityType: "profile", entityId: user.id, metadata: { from: user.role, to: role } });
    return { role };
  }
  return { changeRole };
}

export const accountService = createAccountService({
  async changeRole(userId, from, to) {
    // Compare the stored role too: a concurrent admin promotion cannot be overwritten.
    const { data, error } = await getServiceClient().from("profiles")
      .update({ role: to }).eq("id", userId).eq("role", from).select("id");
    if (error) dbFail("account role update failed", error);
    return data.length === 1;
  },
  audit: recordAudit,
});
