import { describe, expect, it } from "vitest";
import { chooseSpace } from "@/server/ai/agents/demand-matcher";
import { SCENE_1_TEXT, matchLocal } from "../fixtures/matching-corpus";

describe("chooseSpace (design 7.5 step 1)", () => {
  it("uses the model space only with complete coverage and a request model embedding", () => {
    expect(chooseSpace(true, 12, 12)).toBe("model");
  });

  it("partial or no coverage → local", () => {
    expect(chooseSpace(true, 11, 12)).toBe("local");
    expect(chooseSpace(true, 0, 12)).toBe("local");
  });

  it("request without a model embedding → local", () => {
    expect(chooseSpace(false, 12, 12)).toBe("local");
  });

  it("1 model-embedded cluster + 12 local-only clusters → local, and scene 1 still joins the offline cluster", async () => {
    expect(chooseSpace(true, 1, 13)).toBe("local");
    const result = await matchLocal(SCENE_1_TEXT);
    expect(result.space).toBe("local");
    expect(result.recommendation).toBe("join");
    expect(result.candidates[0].title).toBe("Offline AI coding assistant");
  });
});
