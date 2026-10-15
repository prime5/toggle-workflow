import type { FlagSnapshot } from "./index.js";

/** Accepts only a plain object of booleans; anything else is a failed refresh. */
export function parseSnapshot(value: unknown): FlagSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const snapshot: FlagSnapshot = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled !== "boolean") return undefined;
    snapshot[key] = enabled;
  }
  return snapshot;
}

export function sameSnapshot(a: FlagSnapshot, b: FlagSnapshot): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => b[key] === a[key]);
}
