import "@testing-library/jest-dom/vitest";

// jsdom's window.localStorage getter returns undefined in this environment (a real
// jsdom/Node version incompatibility, not anything test-specific -- confirmed via a raw
// `new JSDOM(...)` script: jsdom throws a SecurityError for an opaque origin, and even a
// real `url` option doesn't change the outcome here). Swapped for a minimal in-memory
// polyfill so any test touching localStorage (e.g. onboarding.test.ts) doesn't need real
// browser storage to work.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? (store.get(key) ?? null) : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
}
