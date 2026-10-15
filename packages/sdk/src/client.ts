import { CircuitBreaker, type BreakerState } from "./breaker.js";
import type { EvaluationContext, FlagSnapshot } from "./index.js";
import { parseSnapshot, sameSnapshot } from "./snapshot.js";
import { readSnapshot, writeSnapshot } from "./storage.js";

export type ClientStatus = "live" | "cached" | "degraded";

export interface FlagClientOptions {
  /** Flag server origin, e.g. "http://localhost:4000". */
  baseUrl: string;
  context: EvaluationContext;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface FlagClient {
  /** Synchronous and never throws. Unknown flags are false. */
  isEnabled(key: string): boolean;
  /** Current values. The same object is returned until a value changes. */
  getSnapshot(): FlagSnapshot;
  /** Called after any flag value changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * live: last refresh succeeded. cached: serving last-known values (startup
   * or a failed refresh). degraded: breaker is open or probing.
   */
  status(): ClientStatus;
  breakerState(): BreakerState;
  /** Release this handle. Polling stops when the last handle is closed. */
  close(): void;
}

// One client per page, shared across separately bundled copies of this SDK
// (microfrontends, PLAN step 3b). Symbol.for gives every copy the same key.
const REGISTRY_KEY = Symbol.for("toggle-workflow.sdk.v1");

type Registry = Map<string, ClientCore>;

function registry(): Registry {
  const g = globalThis as { [REGISTRY_KEY]?: Registry };
  g[REGISTRY_KEY] ??= new Map();
  return g[REGISTRY_KEY];
}

function registryKey(baseUrl: string, context: EvaluationContext): string {
  return JSON.stringify([baseUrl, context.userKey, context.customerId ?? null]);
}

/**
 * Returns a handle to the page's client for this server and context, creating
 * it on first use. A second call with the same baseUrl and context, from any
 * copy of the SDK, shares the first client and its options.
 */
export function createFlagClient(options: FlagClientOptions): FlagClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const key = registryKey(baseUrl, options.context);
  const shared = registry();
  let core = shared.get(key);
  if (!core) {
    core = new ClientCore({ ...options, baseUrl }, () => shared.delete(key));
    shared.set(key, core);
  }
  return core.acquire();
}

class ClientCore {
  private readonly baseUrl: string;
  private readonly context: EvaluationContext;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly storageKey: string;
  private readonly breaker = new CircuitBreaker();
  private readonly listeners = new Set<() => void>();
  private readonly onDispose: () => void;

  private snapshot: FlagSnapshot;
  private lastRefreshOk = false;
  private refs = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inflight: AbortController | undefined;
  private disposed = false;

  constructor(options: FlagClientOptions, onDispose: () => void) {
    this.baseUrl = options.baseUrl;
    this.context = options.context;
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.storageKey = `toggle-workflow:snapshot:${registryKey(this.baseUrl, this.context)}`;
    this.onDispose = onDispose;

    // Serve last-known values immediately, then refresh in the background.
    this.snapshot = readSnapshot(this.storageKey) ?? {};
    // Polling for now. Server-sent events would replace the timer later.
    void this.refresh();
  }

  acquire(): FlagClient {
    this.refs += 1;
    const own = new Set<() => void>();
    let closed = false;
    return {
      isEnabled: (key) => this.snapshot[key] === true,
      getSnapshot: () => this.snapshot,
      subscribe: (listener) => {
        const wrapped = () => listener();
        own.add(wrapped);
        this.listeners.add(wrapped);
        return () => {
          own.delete(wrapped);
          this.listeners.delete(wrapped);
        };
      },
      status: () => this.status(),
      breakerState: () => this.breaker.state,
      close: () => {
        if (closed) return;
        closed = true;
        for (const listener of own) this.listeners.delete(listener);
        own.clear();
        this.release();
      },
    };
  }

  private status(): ClientStatus {
    if (this.breaker.state !== "closed") return "degraded";
    return this.lastRefreshOk ? "live" : "cached";
  }

  private release(): void {
    this.refs -= 1;
    if (this.refs > 0) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.inflight?.abort();
    this.listeners.clear();
    this.onDispose();
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.breaker.tryAcquire()) {
      const next = await this.fetchSnapshot();
      if (this.disposed) return;
      if (next) {
        this.breaker.recordSuccess();
        this.lastRefreshOk = true;
        this.apply(next);
      } else {
        this.breaker.recordFailure();
        this.lastRefreshOk = false;
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed) return;
    // While open, wake when the cooldown ends rather than a full poll later,
    // so recovery is not delayed by up to pollIntervalMs.
    const delay =
      this.breaker.state === "open"
        ? Math.min(this.breaker.msUntilRequest(), this.pollIntervalMs)
        : this.pollIntervalMs;
    this.timer = setTimeout(() => void this.refresh(), delay);
    // Don't keep a Node process (SSR, tests, scripts) alive just to poll.
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Resolves to a snapshot, or undefined on any failure. Never rejects. */
  private async fetchSnapshot(): Promise<FlagSnapshot | undefined> {
    if (!this.fetchImpl) return undefined;
    const controller = new AbortController();
    this.inflight = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: this.context }),
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      return parseSnapshot(await response.json());
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      if (this.inflight === controller) this.inflight = undefined;
    }
  }

  private apply(next: FlagSnapshot): void {
    writeSnapshot(this.storageKey, next);
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A failing listener must not break the client or other listeners.
      }
    }
  }
}
