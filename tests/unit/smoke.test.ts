import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("toolchain smoke test", () => {
  it("resolves the @/ alias and runs TypeScript", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
