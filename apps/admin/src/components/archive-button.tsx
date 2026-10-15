"use client";

import { useState, useTransition } from "react";

export function ArchiveButton({ flagKey, action }: { flagKey: string; action: (key: string) => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="btn">
        Archive flag
      </button>
    );
  }
  return (
    <div role="group" aria-label="Confirm archive" className="flex flex-col gap-2 rounded-md border border-[var(--danger)] p-3">
      <p className="text-sm">
        Archive <code className="font-mono">{flagKey}</code>? It will evaluate as off everywhere, and its key can&apos;t be reused.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          className="btn btn-danger"
          onClick={() => startTransition(async () => setError(await action(flagKey)))}
        >
          {pending ? "Archiving…" : "Archive"}
        </button>
        <button type="button" disabled={pending} className="btn" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
