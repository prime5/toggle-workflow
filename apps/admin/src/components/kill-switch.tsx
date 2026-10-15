"use client";

import { useState, useTransition } from "react";

interface Props {
  flagKey: string;
  enabled: boolean;
  /** Returns an error message, or null on success. */
  action: (key: string, enabled: boolean) => Promise<string | null>;
}

/**
 * One click to arm, one to confirm. An inline confirmation rather than
 * window.confirm: it can't be dismissed by a stray Enter, and it's testable.
 */
export function KillSwitch({ flagKey, enabled, action }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const next = !enabled;

  function confirm() {
    startTransition(async () => {
      const message = await action(flagKey, next);
      setError(message);
      setConfirming(false);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`kill-switch-${flagKey}`}>
      <span className={enabled ? "badge badge-on" : "badge badge-off"} aria-label={`${flagKey} is ${enabled ? "on" : "off"}`}>
        {enabled ? "On" : "Off"}
      </span>
      {confirming ? (
        <span role="group" aria-label="Confirm" className="flex items-center gap-2">
          <span className="text-sm">{enabled ? `Turn off ${flagKey} for everyone?` : `Turn on ${flagKey}?`}</span>
          <button type="button" onClick={confirm} disabled={pending} className={enabled ? "btn btn-danger" : "btn btn-primary"}>
            {pending ? "Working…" : enabled ? "Turn off" : "Turn on"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="btn">
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={enabled ? "btn btn-danger" : "btn"}>
          {enabled ? "Kill switch" : "Turn on"}
        </button>
      )}
      {error && (
        <span role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}
