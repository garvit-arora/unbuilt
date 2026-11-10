import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/services/analytics.service", () => ({ platformCounters: vi.fn() }));
vi.mock("@/server/services/discover.service", () => ({ discover: vi.fn() }));
vi.mock("@/server/services/constellation.service", () => ({ getConstellation: vi.fn() }));
vi.mock("@/server/http/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

import { platformCounters } from "@/server/services/analytics.service";
import { discover } from "@/server/services/discover.service";
import { getConstellation } from "@/server/services/constellation.service";
import { loadHome } from "@/server/services/home.service";
import { unstable_rethrow } from "next/navigation";

describe("homepage data availability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps the landing page renderable when the backend is offline", async () => {
    vi.mocked(discover).mockRejectedValue(new Error("fetch failed"));
    vi.mocked(platformCounters).mockRejectedValue(new Error("fetch failed"));
    vi.mocked(getConstellation).mockRejectedValue(new Error("fetch failed"));

    expect(await loadHome()).toEqual({ top: null, counters: null, constellation: null });
  });

  it("retains successful data when only another section fails", async () => {
    const top = { items: [], total: 0, nextCursor: null };
    vi.mocked(discover).mockResolvedValue(top);
    vi.mocked(platformCounters).mockRejectedValue(new Error("counters unavailable"));
    vi.mocked(getConstellation).mockRejectedValue(new Error("constellation unavailable"));

    expect(await loadHome()).toEqual({ top, counters: null, constellation: null });
  });

  it("does not swallow Next.js control-flow signals", async () => {
    const signal = new Error("Next.js control flow");
    vi.mocked(discover).mockRejectedValue(signal);
    vi.mocked(unstable_rethrow).mockImplementation(() => { throw signal; });

    await expect(loadHome()).rejects.toBe(signal);
  });
});
