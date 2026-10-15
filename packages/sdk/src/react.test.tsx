// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlagClient } from "./client.js";
import { FlagProvider, useFlag } from "./react.js";
import { clearRegistry, scriptedFetch } from "./test-helpers.js";

const base = { baseUrl: "http://flags.test", context: { userKey: "u1" } };
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  clearRegistry();
});

function Checkout({ onRender }: { onRender?: () => void }) {
  onRender?.();
  return <p>{useFlag("new-checkout") ? "new checkout" : "old checkout"}</p>;
}

describe("useFlag", () => {
  it("re-renders when the flag changes", async () => {
    const { fetch } = scriptedFetch({ "new-checkout": false }, { "new-checkout": true });
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    render(
      <FlagProvider client={client}>
        <Checkout />
      </FlagProvider>,
    );
    await tick(0);
    expect(screen.getByText("old checkout")).toBeTruthy();
    await tick(1_000);
    expect(screen.getByText("new checkout")).toBeTruthy();
    client.close();
  });

  it("does not re-render when only another flag changes", async () => {
    const { fetch } = scriptedFetch({ "new-checkout": true, other: false }, { "new-checkout": true, other: true });
    const client = createFlagClient({ ...base, fetch, pollIntervalMs: 1_000 });
    const onRender = vi.fn();
    render(
      <FlagProvider client={client}>
        <Checkout onRender={onRender} />
      </FlagProvider>,
    );
    await tick(0);
    const renders = onRender.mock.calls.length;
    await tick(1_000);
    expect(onRender).toHaveBeenCalledTimes(renders);
    client.close();
  });

  it("returns false without a provider instead of throwing", () => {
    render(<Checkout />);
    expect(screen.getByText("old checkout")).toBeTruthy();
  });
});
