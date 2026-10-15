import type { FlagSnapshot } from "./index.js";
import { parseSnapshot } from "./snapshot.js";

// localStorage can be missing (Node, SSR), or throw on access (Safari private
// mode, blocked site data, sandboxed iframes). Every touch is guarded.
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readSnapshot(key: string): FlagSnapshot | undefined {
  try {
    const raw = storage()?.getItem(key);
    return raw ? parseSnapshot(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSnapshot(key: string, snapshot: FlagSnapshot): void {
  try {
    storage()?.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or storage blocked: in-memory values still work.
  }
}
