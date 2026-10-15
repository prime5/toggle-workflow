import Link from "next/link";
import { Suspense } from "react";
import { archiveFlag, setEnabled, updateFlag } from "@/app/actions";
import { ArchiveButton } from "@/components/archive-button";
import { formatDate, StatusBadges } from "@/components/flag-badges";
import { FlagForm } from "@/components/flag-form";
import { KillSwitch } from "@/components/kill-switch";
import { flagServer } from "@/lib/flag-server";

type Params = Promise<{ key: string }>;

export default function FlagPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading flag…</p>}>
      <FlagDetail params={params} />
    </Suspense>
  );
}

async function FlagDetail({ params }: { params: Params }) {
  const key = decodeURIComponent((await params).key);
  const result = await flagServer.get(key);

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="notice notice-error">
          {result.status === 404 ? `No flag named "${key}".` : result.error.message}
        </p>
        <Link href="/" className="text-[var(--accent)]">
          Back to flags
        </Link>
      </div>
    );
  }

  const flag = result.data;
  const archived = flag.archivedAt !== null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          ← Flags
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{flag.key}</h1>
          <StatusBadges flag={flag} />
        </div>
        {archived ? (
          <p className="notice">Archived on {formatDate(flag.archivedAt!)}. It evaluates as off everywhere and can&apos;t be edited.</p>
        ) : (
          <KillSwitch flagKey={flag.key} enabled={flag.enabled} action={setEnabled} />
        )}
        {flag.stale && !archived && (
          <p className="notice text-[var(--warn)] border-[var(--warn)]">
            This flag expired on {formatDate(flag.expiresAt)}. Ship the feature and archive the flag, or move the expiry date.
          </p>
        )}
      </div>

      {!archived && (
        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Settings</h2>
          <FlagForm
            mode="edit"
            action={updateFlag.bind(null, flag.key)}
            initial={{ ...flag, expiresAt: formatDate(flag.expiresAt) }}
          />
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <Placeholder title="Pull requests" phase={2}>
          PRs that reference <code className="font-mono">{flag.key}</code> in code or carry a <code className="font-mono">flag:{flag.key}</code> label.
        </Placeholder>
        <Placeholder title="Preview" phase={3}>
          A signed link that shows this feature switched on, without a separate environment.
        </Placeholder>
      </section>

      {!archived && (
        <section>
          <ArchiveButton flagKey={flag.key} action={archiveFlag} />
        </section>
      )}
    </div>
  );
}

function Placeholder({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  return (
    <div className="card border-dashed p-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="badge badge-off">Coming in phase {phase}</span>
      </div>
      <p className="text-sm text-[var(--muted)]">{children}</p>
    </div>
  );
}
