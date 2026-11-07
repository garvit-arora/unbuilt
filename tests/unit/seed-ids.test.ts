import { describe, expect, it } from "vitest";
import { v5 as uuidv5 } from "uuid";
import { ensureSeedUser, findUserIdByEmail, nonSeedIdMessage, type AdminAuth } from "../../scripts/seed-lib/accounts";
import { UNBUILT_SEED_NAMESPACE, seedFraction, seedId, seedUserId } from "../../scripts/seed-lib/ids";
import { joinTimes, syntheticUserIndex } from "../../scripts/seed";
import { SEED_CLUSTERS } from "../../scripts/seed-data/clusters";

type FakeUser = { id: string; email: string };

function fakeAdmin(existing: FakeUser[], createError?: { message: string; status?: number; code?: string }) {
  const created: FakeUser[] = [];
  const admin: AdminAuth = {
    async createUser(attrs) {
      if (createError) return { data: { user: null }, error: createError };
      if (existing.some((u) => u.email === attrs.email)) {
        return { data: { user: null }, error: { message: "A user with this email address has already been registered", status: 422, code: "email_exists" } };
      }
      created.push({ id: attrs.id, email: attrs.email });
      return { data: { user: { id: attrs.id } }, error: null };
    },
    async listUsers({ page, perPage }) {
      const all = [...existing, ...created];
      return { data: { users: all.slice((page - 1) * perPage, page * perPage) }, error: null };
    },
  };
  return { admin, created };
}

const account = { email: "buyer@unbuilt.demo", password: "pw-123456", displayName: "Demo Buyer", role: "buyer" as const };

describe("seed ids", () => {
  it("are uuidv5(name, UNBUILT_SEED_NAMESPACE) and stable across runs", () => {
    expect(seedUserId("buyer@unbuilt.demo")).toBe(uuidv5("buyer@unbuilt.demo", UNBUILT_SEED_NAMESPACE));
    expect(seedUserId("Buyer@Unbuilt.demo")).toBe(seedUserId("buyer@unbuilt.demo"));
    expect(seedId("cluster:offline-ai-coding-assistant")).toBe(seedId("cluster:offline-ai-coding-assistant"));
    expect(seedId("a")).not.toBe(seedId("b"));
    expect(seedFraction("x")).toBe(seedFraction("x"));
    expect(seedFraction("x")).toBeGreaterThanOrEqual(0);
    expect(seedFraction("x")).toBeLessThan(1);
  });

  it("gives every cluster distinct synthetic members and join times inside its window", () => {
    const now = Date.UTC(2026, 10, 7);
    SEED_CLUSTERS.forEach((fixture, ci) => {
      const users = fixture.requests.map((_, j) => syntheticUserIndex(ci, j));
      expect(new Set(users).size).toBe(users.length);
      const times = joinTimes(fixture, now);
      expect(Math.min(...times)).toBe(times[0]);
      expect(Math.max(...times)).toBeLessThan(now);
      expect(times[0]).toBe(now - fixture.startDaysAgo * 24 * 3600 * 1000);
    });
  });
});

describe("ensureSeedUser (patch NIT 2)", () => {
  it("creates the user with the deterministic id", async () => {
    const { admin, created } = fakeAdmin([]);
    expect(await ensureSeedUser(admin, account)).toBe(seedUserId(account.email));
    expect(created).toEqual([{ id: seedUserId(account.email), email: account.email }]);
  });

  it("email_exists with the matching id logs info and continues", async () => {
    const logs: string[] = [];
    const { admin } = fakeAdmin([{ id: seedUserId(account.email), email: account.email }]);
    expect(await ensureSeedUser(admin, account, (m) => logs.push(m))).toBe(seedUserId(account.email));
    expect(logs[0]).toMatch(/^info: buyer@unbuilt.demo already exists/);
  });

  it("email_exists with a different id aborts with the actionable message", async () => {
    const { admin } = fakeAdmin([{ id: "11111111-1111-4111-8111-111111111111", email: account.email }]);
    await expect(ensureSeedUser(admin, account)).rejects.toThrow(nonSeedIdMessage(account.email));
    expect(nonSeedIdMessage(account.email)).toBe("User buyer@unbuilt.demo exists with a non-seed id; delete it or run `supabase db reset`");
  });

  it("treats a 422 'already been registered' without a code as existing", async () => {
    const { admin } = fakeAdmin([{ id: "11111111-1111-4111-8111-111111111111", email: account.email }]);
    const legacy: AdminAuth = {
      ...admin,
      async createUser() {
        return { data: { user: null }, error: { message: "User already been registered", status: 422 } };
      },
    };
    await expect(ensureSeedUser(legacy, account)).rejects.toThrow("non-seed id");
  });

  it("rethrows any other error", async () => {
    const { admin } = fakeAdmin([], { message: "Database error creating new user", status: 500, code: "unexpected_failure" });
    await expect(ensureSeedUser(admin, account)).rejects.toThrow("Creating buyer@unbuilt.demo failed: Database error creating new user");
  });

  it("looks the existing user up through paginated listUsers", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `id-${i}`, email: `u${i}@x.test` }));
    const { admin } = fakeAdmin(many);
    expect(await findUserIdByEmail(admin, "U4@x.test", 2)).toBe("id-4");
    expect(await findUserIdByEmail(admin, "missing@x.test", 2)).toBeNull();
  });
});
