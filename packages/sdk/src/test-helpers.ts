import type { FlagSnapshot } from "./index.js";

type Reply = FlagSnapshot | "fail" | "hang" | { status: number } | { body: unknown };

/**
 * A fetch that answers /v1/evaluate from a script of replies, one per call;
 * the last reply repeats. "hang" never answers until the request is aborted.
 */
export function scriptedFetch(...replies: Reply[]) {
  const calls: RequestInit[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    const reply = replies[Math.min(i++, replies.length - 1)];
    if (reply === "fail") throw new TypeError("network down");
    if (reply === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    if ("status" in reply && typeof reply.status === "number") return new Response("{}", { status: reply.status });
    if ("body" in reply) return Response.json(reply.body);
    return Response.json(reply);
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (n) => [...data.keys()][n] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

export function clearRegistry(): void {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("toggle-workflow.sdk.v1")];
}
