export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures that open the breaker. */
  failureThreshold?: number;
  /** First cooldown after opening; doubles on each failed probe. */
  baseCooldownMs?: number;
  maxCooldownMs?: number;
  now?: () => number;
}

/**
 * closed    -> requests flow; `failureThreshold` consecutive failures open it.
 * open      -> requests are skipped until the cooldown has elapsed.
 * half-open -> exactly one probe is allowed. Success closes the breaker and
 *              resets the cooldown; failure re-opens it with the cooldown doubled.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly now: () => number;

  private current: BreakerState = "closed";
  private failures = 0;
  private cooldownMs: number;
  private openedAt = 0;
  private probeInFlight = false;

  constructor(options: BreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.baseCooldownMs = options.baseCooldownMs ?? 5_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.cooldownMs = this.baseCooldownMs;
  }

  get state(): BreakerState {
    return this.current;
  }

  get cooldown(): number {
    return this.cooldownMs;
  }

  /** Milliseconds until a request would be allowed; 0 if allowed now. */
  msUntilRequest(): number {
    if (this.current !== "open") return 0;
    return Math.max(0, this.openedAt + this.cooldownMs - this.now());
  }

  /** Ask before each request. Moves open -> half-open once the cooldown is over. */
  tryAcquire(): boolean {
    if (this.current === "open" && this.msUntilRequest() === 0) {
      this.current = "half-open";
    }
    if (this.current === "closed") return true;
    if (this.current === "half-open" && !this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.current = "closed";
    this.failures = 0;
    this.cooldownMs = this.baseCooldownMs;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    if (this.current === "half-open") {
      this.probeInFlight = false;
      this.cooldownMs = Math.min(this.cooldownMs * 2, this.maxCooldownMs);
      this.open();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.current = "open";
    this.openedAt = this.now();
  }
}
