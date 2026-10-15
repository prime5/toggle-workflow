import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlagClient } from "./client.js";
import { clearRegistry, memoryStorage, scriptedFetch } from "./test-helpers.js";

const base = { baseUrl: "http://flags.test", context: { userKey: "u1" } };
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearRegistry();
});

describe("createFlagClient", () => {
  it("returns false for unknown flags and before the first response", async () => {
    const { fetch } = scriptedFetch({ known: true });
    const client = createFlagClient({ ...base, fetch });
    expect(client.isEnabled("known")).toBe(false);
    await settle();
    expect(client.isEnabled("known")).toBe(true);
    expect(client.isEnabled("missing")).toBe(false);
    expect(client.status()).toBe("live");
    client.close();
  });

  it("posts the context to /v1/evaluate", async () => {
    const { fetch, calls } = scriptedFetch({});
    const client = createFlagClient({ ...base, baseUrl: "http://flags.test/", fetch });
    await settle();
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ context: { userKey: "u1" } });
    client.close();
  });

  it("keeps the last good values when a refresh fails", async () => {
    const { fetch } = scriptedFetch({ checkout: true }, "fail");
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.isEnabled("checkout")).toBe(true);
    expect(client.status()).toBe("cached");
    client.close();
  });

  it("serves the stored snapshot immediately on startup, then refreshes", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const { fetch: up } = scriptedFetch({ checkout: true });
    const warm = createFlagClient({ ...base, fetch: up }); // previous page load
    await settle();
    warm.close();

    const { fetch: down } = scriptedFetch("fail");
    const client = createFlagClient({ ...base, fetch: down });
    expect(client.isEnabled("checkout")).toBe(true); // synchronous, before any response
    expect(client.status()).toBe("cached");
    client.close();
  });

  it("treats non-2xx and malformed bodies as failures", async () => {
    const { fetch } = scriptedFetch({ a: true }, { status: 500 }, { body: { a: "yes" } }, { body: [true] });
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(client.breakerState()).toBe("closed"); // two failures so far
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.isEnabled("a")).toBe(true);
    expect(client.breakerState()).toBe("open"); // three failures in a row
    client.close();
  });

  it("counts a timeout as a failure", async () => {
    const { fetch } = scriptedFetch("hang");
    const client = createFlagClient({ ...base, fetch, timeoutMs: 2_000, pollIntervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000); // 1st request times out
    expect(client.status()).toBe("cached");
    await vi.advanceTimersByTimeAsync(3_000 * 2); // 2nd and 3rd
    expect(client.breakerState()).toBe("open");
    expect(client.status()).toBe("degraded");
    client.close();
  });

  it("skips requests while open, probes once after the cooldown, closes on success", async () => {
    const { fetch, calls } = scriptedFetch("fail", "fail", "fail", { a: true });
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(client.breakerState()).toBe("open");
    expect(calls).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(3); // nothing sent during the 5s cooldown
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(4); // the half-open probe
    expect(client.breakerState()).toBe("closed");
    expect(client.status()).toBe("live");
    expect(client.isEnabled("a")).toBe(true);
    client.close();
  });

  it("notifies subscribers only when a value changes", async () => {
    const { fetch } = scriptedFetch({ a: false }, { a: false }, { a: true });
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    const listener = vi.fn();
    client.subscribe(listener);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1); // {} -> {a:false}
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(1); // unchanged
    await vi.advanceTimersByTimeAsync(1_000);
    expect(listener).toHaveBeenCalledTimes(2);
    client.close();
  });

  it("a throwing listener does not stop other listeners", async () => {
    const { fetch } = scriptedFetch({ a: true });
    const client = createFlagClient({ ...base, fetch });
    const second = vi.fn();
    client.subscribe(() => {
      throw new Error("boom");
    });
    client.subscribe(second);
    await settle();
    expect(second).toHaveBeenCalledOnce();
    client.close();
  });

  it("works when localStorage throws on access or on write", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      const { fetch } = scriptedFetch({ a: true });
      const client = createFlagClient({ ...base, fetch });
      await settle();
      expect(client.isEnabled("a")).toBe(true);
      client.close();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }

    const full = memoryStorage();
    full.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    vi.stubGlobal("localStorage", full);
    const { fetch } = scriptedFetch({ b: true });
    const client = createFlagClient({ ...base, fetch });
    await settle();
    expect(client.isEnabled("b")).toBe(true);
    client.close();
  });

  it("stops polling after close", async () => {
    const { fetch, calls } = scriptedFetch({});
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    client.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });
});

describe("one client per page", () => {
  it("handles for the same server and context share one client", async () => {
    const { fetch, calls } = scriptedFetch({ a: true });
    const a = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    const b = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toHaveLength(4); // one per poll, not two
    expect(b.isEnabled("a")).toBe(true);

    a.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(5); // b still polls
    b.close();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(5);
  });

  it("a different user or customer gets its own client", async () => {
    const { fetch, calls } = scriptedFetch({});
    const a = createFlagClient({ ...base, fetch });
    const b = createFlagClient({ ...base, context: { userKey: "u1", customerId: "acme" }, fetch });
    await settle();
    expect(calls).toHaveLength(2);
    a.close();
    b.close();
  });

  it("two separately loaded copies of the SDK share one client", async () => {
    vi.resetModules();
    const copyA = await import("./client.js?copy=a" as string);
    vi.resetModules();
    const copyB = await import("./client.js?copy=b" as string);
    expect(copyA.createFlagClient).not.toBe(copyB.createFlagClient);

    const { fetch, calls } = scriptedFetch({ a: true });
    const a = copyA.createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    const b = copyB.createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect(a.isEnabled("a") && b.isEnabled("a")).toBe(true);
    a.close();
    b.close();
  });
});
