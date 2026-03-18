// Minimal server-safe polyfills for Web APIs that may not exist in Node runtimes.

// Provide an in-memory localStorage on the server so SSR doesn't crash when
// third-party code accesses it. Browsers keep their native implementation.
if (typeof window === "undefined") {
  const memoryStorage = (() => {
    const store = new Map<string, string>();

    return {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage;
  })();

  if (
    typeof globalThis.localStorage !== "object" ||
    typeof globalThis.localStorage?.getItem !== "function"
  ) {
    (globalThis as unknown as { localStorage?: Storage }).localStorage = memoryStorage;
  }
}

export {};
