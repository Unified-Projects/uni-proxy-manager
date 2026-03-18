import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn utility", () => {
  it("merges class names", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });

  it("applies tailwind precedence when merging", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
