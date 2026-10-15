import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./breaker.js";

function breakerAt() {
  let t = 0;
  const breaker = new CircuitBreaker({ now: () => t });
  return { breaker, advance: (ms: number) => (t += ms) };
}

function fail(breaker: CircuitBreaker, times: number) {
  for (let i = 0; i < times; i++) {
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure();
  }
}

describe("CircuitBreaker", () => {
  it("opens after 3 consecutive failures, not before", () => {
    const { breaker } = breakerAt();
    fail(breaker, 2);
    expect(breaker.state).toBe("closed");
    fail(breaker, 1);
    expect(breaker.state).toBe("open");
    expect(breaker.tryAcquire()).toBe(false);
  });

  it("a success resets the consecutive failure count", () => {
    const { breaker } = breakerAt();
    fail(breaker, 2);
    breaker.recordSuccess();
    fail(breaker, 2);
    expect(breaker.state).toBe("closed");
  });

  it("closed -> open -> half-open (one probe) -> closed", () => {
    const { breaker, advance } = breakerAt();
    fail(breaker, 3);
    advance(4_999);
    expect(breaker.tryAcquire()).toBe(false);
    advance(1);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.state).toBe("half-open");
    expect(breaker.tryAcquire()).toBe(false); // only one probe in flight
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(breaker.cooldown).toBe(5_000);
  });

  it("a failed probe re-opens with the cooldown doubled, capped at 60s", () => {
    const { breaker, advance } = breakerAt();
    fail(breaker, 3);
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      advance(breaker.msUntilRequest());
      expect(breaker.tryAcquire()).toBe(true);
      breaker.recordFailure();
      expect(breaker.state).toBe("open");
      seen.push(breaker.cooldown);
    }
    expect(seen).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
  });
});
