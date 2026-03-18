import { describe, it, expect, beforeEach, vi } from "vitest";

describe("server polyfills", () => {
  beforeEach(() => {
    // Ensure polyfill runs fresh each time
    // @ts-expect-error allow cleanup
    delete globalThis.localStorage;
    vi.resetModules();
  });

  it("provides an in-memory localStorage when window is undefined", async () => {
    await import("./polyfills");

    expect(globalThis.localStorage).toBeDefined();
    globalThis.localStorage.setItem("foo", "bar");
    expect(globalThis.localStorage.getItem("foo")).toBe("bar");
    globalThis.localStorage.removeItem("foo");
    expect(globalThis.localStorage.getItem("foo")).toBeNull();
  });
});
