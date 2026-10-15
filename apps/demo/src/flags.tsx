"use client";

import { createFlagClient, type FlagClient } from "@toggle-workflow/sdk";
import { FlagProvider } from "@toggle-workflow/sdk/react";
import { useEffect, useState, type ReactNode } from "react";

const USER_KEY = "toggle-workflow-demo:user";

/** A stable anonymous id per browser, so percentage rollouts are sticky. */
function userKey(): string {
  try {
    const existing = localStorage.getItem(USER_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(USER_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Creates the flag client in the browser only. On the server there is no
 * client (flags read as off), because a client created during server rendering
 * would be shared by every visitor through the SDK's per-page registry.
 *
 * Known gap: a visitor with a flag on sees the old UI for the first paint until
 * the client loads (instant on later visits, from the stored snapshot). Serving
 * a server-evaluated snapshot with the HTML would remove it.
 */
export function FlagsRoot({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<FlagClient | null>(null);

  useEffect(() => {
    // An absolute URL on this origin: the request goes to this app's
    // /flags rewrite (see next.config.ts), not to the flag server directly.
    const created = createFlagClient({
      baseUrl: `${window.location.origin}/flags`,
      context: { userKey: userKey() },
      pollIntervalMs: 5_000, // demo: show admin changes quickly
    });
    setClient(created);
    return () => created.close();
  }, []);

  return <FlagProvider client={client}>{children}</FlagProvider>;
}
