import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { FlagClient } from "./client.js";

const FlagContext = createContext<FlagClient | null>(null);

export function FlagProvider({ client, children }: { client: FlagClient; children?: ReactNode }) {
  return <FlagContext.Provider value={client}>{children}</FlagContext.Provider>;
}

const noSubscribe = () => () => {};

/**
 * Re-renders when the flag's value changes. Without a FlagProvider it returns
 * false rather than throwing, consistent with the client never breaking the app.
 */
export function useFlag(key: string): boolean {
  const client = useContext(FlagContext);
  // Selecting a boolean (not the whole snapshot) means a component only
  // re-renders when its own flag changes.
  const getValue = () => client?.isEnabled(key) ?? false;
  return useSyncExternalStore(client ? client.subscribe : noSubscribe, getValue, getValue);
}
