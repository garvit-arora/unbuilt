import { describe, expect, it, vi } from "vitest";
import { RoleChangeSchema } from "@/lib/schemas/auth";
import { createAccountService } from "@/server/services/account.service";
import { createRoute } from "@/server/http/handler";
import type { SessionUser } from "@/server/auth/guards";

const buyer: SessionUser = { id: "account-1", role: "buyer", displayName: "Buyer", email: null, isPlatformBuilder: false };

function setup() {
  const changeRole = vi.fn(async () => true);
  const audit = vi.fn(async () => {});
  const service = createAccountService({ changeRole, audit });
  return { service, changeRole, audit };
}

describe("self-service account roles", () => {
  it("updates only the signed-in account and records the transition", async () => {
    const { service, changeRole, audit } = setup();
    expect(await service.changeRole(buyer, "builder")).toEqual({ role: "builder" });
    expect(changeRole).toHaveBeenCalledWith(buyer.id, "buyer", "builder");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: buyer.id, entityId: buyer.id, metadata: { from: "buyer", to: "builder" } }));
  });

  it("allows a builder to return to buyer", async () => {
    const { service, changeRole } = setup();
    expect(await service.changeRole({ ...buyer, role: "builder" }, "buyer")).toEqual({ role: "buyer" });
    expect(changeRole).toHaveBeenCalledWith(buyer.id, "builder", "buyer");
  });

  it("does not rewrite or audit an unchanged role", async () => {
    const { service, changeRole, audit } = setup();
    await service.changeRole(buyer, "buyer");
    expect(changeRole).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("blocks self-demotion of admin accounts", async () => {
    const { service, changeRole } = setup();
    await expect(service.changeRole({ ...buyer, role: "admin" }, "buyer")).rejects.toMatchObject({ status: 403 });
    expect(changeRole).not.toHaveBeenCalled();
  });

  it("rejects admin assignment and another account's id", () => {
    expect(RoleChangeSchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(RoleChangeSchema.safeParse({ role: "builder", userId: "someone-else" }).success).toBe(false);
    expect(RoleChangeSchema.safeParse({ role: "builder", is_platform_builder: true }).success).toBe(false);
  });

  it("rejects a stale update instead of overwriting a newer role", async () => {
    const { service, changeRole, audit } = setup();
    changeRole.mockResolvedValue(false);
    await expect(service.changeRole(buyer, "builder")).rejects.toMatchObject({ status: 409 });
    expect(audit).not.toHaveBeenCalled();
  });

  it("requires authentication, validates the request and checks its origin", async () => {
    const { service, changeRole } = setup();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const endpoint = (user: SessionUser | null) => createRoute({ getUser: async () => user, rateLimiter: async () => true, allowedOrigins: ["http://localhost:3000"], rateLimitSalt: "test", logger })({
      auth: "required", roles: ["buyer", "builder"], body: RoleChangeSchema,
      handler: ({ user, body }) => service.changeRole(user, body.role),
    });
    const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/account/role", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    expect((await endpoint(null)(request({ role: "builder" }))).status).toBe(401);
    expect((await endpoint(buyer)(request({ role: "admin" }))).status).toBe(400);
    expect((await endpoint(buyer)(request({ role: "builder" }, "https://other.test"))).status).toBe(403);
    expect((await endpoint({ ...buyer, role: "admin" })(request({ role: "buyer" }))).status).toBe(403);
    expect(changeRole).not.toHaveBeenCalled();
  });
});
